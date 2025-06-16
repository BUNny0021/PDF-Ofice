// server.js - FINAL VERSION WITH MEMORY BUFFER FIX FOR LIBREOFFICE

const express = require('express');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const { PDFDocument } = require('pdf-lib');
const libre = require('libreoffice-convert');
const Jimp = require('jimp');
const ExcelJS = require('exceljs');
const pdf = require('pdf-parse');

// Make libreoffice-convert's callback-based function into a modern async/await function
const convertAsync = promisify(libre.convert);

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static('public'));
const uploadDir = path.join(__dirname, 'uploads');
fs.mkdir(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

const cleanupFiles = async (...files) => {
  for (const file of files) {
    if (file && typeof file === 'string') {
      try {
        await fs.unlink(file);
      } catch (err) { /* Don't crash if cleanup fails */ }
    }
  }
};

const handleError = (res, err, friendlyMessage, ...filesToClean) => {
    const errorMessage = err.message || 'An unknown error occurred.';
    console.error(`SERVER ERROR: ${friendlyMessage}. Details:`, err);
    cleanupFiles(...filesToClean);
    res.status(500).json({ 
        message: friendlyMessage, 
        error: errorMessage
    });
};

// --- API ENDPOINTS WITH THE FIX ---

// Helper function for all LibreOffice conversions
const performConversion = async (res, file, outputExtension) => {
    if (!file) return res.status(400).json({ message: 'No file uploaded.' });
    const { path: inputPath, originalname } = file;
    const outputFilename = `${path.parse(originalname).name}.${outputExtension}`;

    try {
        const fileBuffer = await fs.readFile(inputPath);
        
        // Let the library return the converted file as a memory buffer
        const outputBuffer = await convertAsync(fileBuffer, outputExtension, undefined);
        
        // Send the buffer directly to the user for download
        res.setHeader('Content-Disposition', `attachment; filename=${outputFilename}`);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.send(outputBuffer);

    } catch (err) {
        handleError(res, err, `Failed to convert file to ${outputExtension}.`);
    } finally {
        // Always clean up the original uploaded file
        cleanupFiles(inputPath);
    }
};

// PDF to Word
app.post('/api/pdftoword', upload.single('file'), (req, res) => {
    performConversion(res, req.file, 'docx');
});

// Word to PDF
app.post('/api/wordtopdf', upload.single('file'), (req, res) => {
    performConversion(res, req.file, 'pdf');
});

// Excel to PDF
app.post('/api/exceltopdf', upload.single('file'), (req, res) => {
    performConversion(res, req.file, 'pdf');
});

// --- Other Endpoints ---

// Merge PDF
app.post('/api/merge', upload.array('files'), async (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ message: 'No files uploaded.' });
  const paths = req.files.map(f => f.path);
  try {
    const mergedPdf = await PDFDocument.create();
    for (const pdfPath of paths) {
      const pdfBytes = await fs.readFile(pdfPath);
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const copiedPages = await mergedPdf.copyPages(pdfDoc, pdfDoc.getPageIndices());
      copiedPages.forEach(page => mergedPdf.addPage(page));
    }
    const mergedPdfBytes = await pdfDoc.save();
    res.setHeader('Content-Disposition', 'attachment; filename=merged.pdf');
    res.setHeader('Content-Type', 'application/pdf');
    res.send(Buffer.from(mergedPdfBytes));
  } catch (err) {
    handleError(res, err, 'Failed to merge PDFs.');
  } finally {
      cleanupFiles(...paths);
  }
});

// Split PDF
app.post('/api/split', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });
    let inputPath = req.file.path;
    try {
        const originalPdfBytes = await fs.readFile(inputPath);
        const originalPdf = await PDFDocument.load(originalPdfBytes);
        console.log(`PDF has ${originalPdf.getPageCount()} pages. Placeholder returns original.`);
        res.download(inputPath, 'split-result.pdf', () => cleanupFiles(inputPath));
    } catch (err) {
        handleError(res, err, 'Failed to split PDF.', inputPath);
    }
});

// Compress PDF (Placeholder)
app.post('/api/compress', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });
    let inputPath = req.file.path;
    res.download(inputPath, `compressed-${req.file.originalname}`, () => cleanupFiles(inputPath));
});

// JPG to PDF
app.post('/api/jpgtopdf', upload.array('files'), async (req, res) => {
    if (!req.files || req.files.length === 0) return res.status(400).json({ message: 'No files uploaded.' });
    const paths = req.files.map(f => f.path);
    try {
        const pdfDoc = await PDFDocument.create();
        for (const imgPath of paths) {
            const img = await Jimp.read(imgPath);
            const imgBytes = await img.getBufferAsync(Jimp.MIME_PNG);
            const pdfImage = await pdfDoc.embedPng(imgBytes);
            const page = pdfDoc.addPage([pdfImage.width, pdfImage.height]);
            page.drawImage(pdfImage, { x: 0, y: 0, width: pdfImage.width, height: pdfImage.height });
        }
        const pdfBytes = await pdfDoc.save();
        res.setHeader('Content-Disposition', 'attachment; filename=converted.pdf');
        res.setHeader('Content-Type', 'application/pdf');
        res.send(Buffer.from(pdfBytes));
    } catch (err) {
        handleError(res, err, 'Failed to convert JPG to PDF.');
    } finally {
        cleanupFiles(...paths);
    }
});

// PDF to JPG
app.post('/api/pdftojpg', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });
    const inputPath = req.file.path;
    const outputPrefix = path.join(uploadDir, path.parse(inputPath).name);
    const command = `pdftocairo -jpeg "${inputPath}" "${outputPrefix}"`;
    exec(command, (error, stdout, stderr) => {
        if (error) { return handleError(res, error, 'Failed to convert PDF to JPG.', inputPath); }
        const firstPagePath = `${outputPrefix}-1.jpg`;
        res.download(firstPagePath, `${path.parse(req.file.originalname).name}.jpg`, (err) => {
            if (err) console.error('Download error:', err);
            cleanupFiles(inputPath, firstPagePath);
        });
    });
});

// Rotate PDF
app.post('/api/rotate', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });
    const inputPath = req.file.path;
    try {
        const pdfBytes = await fs.readFile(inputPath);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        pdfDoc.getPages().forEach(page => page.setRotation(page.getRotation().angle + 90));
        const rotatedPdfBytes = await pdfDoc.save();
        res.setHeader('Content-Disposition', 'attachment; filename=rotated.pdf');
        res.setHeader('Content-Type', 'application/pdf');
        res.send(Buffer.from(rotatedPdfBytes));
    } catch (err) {
        handleError(res, err, 'Failed to rotate PDF.');
    } finally {
        cleanupFiles(inputPath);
    }
});

// Unlock PDF
app.post('/api/unlock', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });
    const { password } = req.body;
    if (!password) return res.status(400).json({ message: 'Password is required for unlocking.' });
    const inputPath = req.file.path;
    try {
        const pdfBytes = await fs.readFile(inputPath);
        const pdfDoc = await PDFDocument.load(pdfBytes, { password });
        const unlockedBytes = await pdfDoc.save();
        res.setHeader('Content-Disposition', `attachment; filename=unlocked-${req.file.originalname}`);
        res.setHeader('Content-Type', 'application/pdf');
        res.send(Buffer.from(unlockedBytes));
    } catch (err) {
        handleError(res, err, 'Failed to unlock PDF. Check password.');
    } finally {
        cleanupFiles(inputPath);
    }
});

// Protect PDF
app.post('/api/protect', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });
    const { password } = req.body;
    if (!password) return res.status(400).json({ message: 'Password is required for protecting.' });
    const inputPath = req.file.path;
    try {
        const pdfBytes = await fs.readFile(inputPath);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const protectedBytes = await pdfDoc.save({ userPassword: password, ownerPassword: password });
        res.setHeader('Content-Disposition', `attachment; filename=protected-${req.file.originalname}`);
        res.setHeader('Content-Type', 'application/pdf');
        res.send(Buffer.from(protectedBytes));
    } catch (err) {
        handleError(res, err, 'Failed to protect PDF.');
    } finally {
        cleanupFiles(inputPath);
    }
});

// PDF to Excel
app.post('/api/pdftoexcel', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });
    const inputPath = req.file.path;
    try {
        const dataBuffer = await fs.readFile(inputPath);
        const data = await pdf(dataBuffer);
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Extracted Text');
        data.text.split('\n').forEach(line => worksheet.addRow([line]));
        
        // Write to a buffer in memory
        const buffer = await workbook.xlsx.writeBuffer();
        
        res.setHeader('Content-Disposition', 'attachment; filename=converted.xlsx');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (err) {
        handleError(res, err, 'Failed to convert PDF to Excel.');
    } finally {
        cleanupFiles(inputPath);
    }
});

app.listen(port, () => {
    console.log(`Server is live and running on port ${port}`);
});
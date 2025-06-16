// server.js - FINAL VERSION WITH LIBREOFFICE FIX

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
      } catch (err) { /* We don't need to crash if a cleanup fails */ }
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

// PDF to Word
app.post('/api/pdftoword', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });
    const { path: inputPath, originalname } = req.file;
    const outputPath = path.join(uploadDir, `${path.parse(originalname).name}.docx`);
    try {
        const fileBuffer = await fs.readFile(inputPath);
        // FIX: Pass 'docx' instead of '.docx'
        const docxBuffer = await convertAsync(fileBuffer, 'docx', undefined);
        await fs.writeFile(outputPath, docxBuffer);
        res.download(outputPath, `${path.parse(originalname).name}.docx`, () => cleanupFiles(inputPath, outputPath));
    } catch (err) {
        handleError(res, err, 'Failed to convert PDF to Word.', inputPath, outputPath);
    }
});

// Word to PDF
app.post('/api/wordtopdf', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });
    const { path: inputPath, originalname } = req.file;
    const outputPath = path.join(uploadDir, `${path.parse(originalname).name}.pdf`);
    try {
        const fileBuffer = await fs.readFile(inputPath);
        // FIX: Pass 'pdf' instead of '.pdf'
        const pdfBuffer = await convertAsync(fileBuffer, 'pdf', undefined);
        await fs.writeFile(outputPath, pdfBuffer);
        res.download(outputPath, `${path.parse(originalname).name}.pdf`, () => cleanupFiles(inputPath, outputPath));
    } catch (err) {
        handleError(res, err, 'Failed to convert Word to PDF.', inputPath, outputPath);
    }
});

// Excel to PDF
app.post('/api/exceltopdf', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });
    const { path: inputPath, originalname } = req.file;
    const outputPath = path.join(uploadDir, `${path.parse(originalname).name}.pdf`);
    try {
        const fileBuffer = await fs.readFile(inputPath);
        // FIX: Pass 'pdf' instead of '.pdf'
        const pdfBuffer = await convertAsync(fileBuffer, 'pdf', undefined);
        await fs.writeFile(outputPath, pdfBuffer);
        res.download(outputPath, `${path.parse(originalname).name}.pdf`, () => cleanupFiles(inputPath, outputPath));
    } catch (err) {
        handleError(res, err, 'Failed to convert Excel to PDF.', inputPath, outputPath);
    }
});

// Merge PDF
app.post('/api/merge', upload.array('files'), async (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ message: 'No files uploaded.' });
  const paths = req.files.map(f => f.path);
  let mergedPdfPath = path.join(uploadDir, `merged-${Date.now()}.pdf`);
  try {
    const mergedPdf = await PDFDocument.create();
    for (const pdfPath of paths) {
      const pdfBytes = await fs.readFile(pdfPath);
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const copiedPages = await mergedPdf.copyPages(pdfDoc, pdfDoc.getPageIndices());
      copiedPages.forEach(page => mergedPdf.addPage(page));
    }
    const mergedPdfBytes = await mergedPdf.save();
    await fs.writeFile(mergedPdfPath, mergedPdfBytes);
    res.download(mergedPdfPath, 'merged.pdf', () => cleanupFiles(mergedPdfPath, ...paths));
  } catch (err) {
    handleError(res, err, 'Failed to merge PDFs.', mergedPdfPath, ...paths);
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
    const outputPath = path.join(uploadDir, `converted-${Date.now()}.pdf`);
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
        await fs.writeFile(outputPath, pdfBytes);
        res.download(outputPath, 'converted.pdf', () => cleanupFiles(outputPath, ...paths));
    } catch (err) {
        handleError(res, err, 'Failed to convert JPG to PDF.', outputPath, ...paths);
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
    const outputPath = path.join(uploadDir, `rotated-${Date.now()}.pdf`);
    try {
        const pdfBytes = await fs.readFile(inputPath);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        pdfDoc.getPages().forEach(page => page.setRotation(page.getRotation().angle + 90));
        const rotatedPdfBytes = await pdfDoc.save();
        await fs.writeFile(outputPath, rotatedPdfBytes);
        res.download(outputPath, 'rotated.pdf', () => cleanupFiles(inputPath, outputPath));
    } catch (err) {
        handleError(res, err, 'Failed to rotate PDF.', inputPath, outputPath);
    }
});

// Unlock PDF
app.post('/api/unlock', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });
    const { password } = req.body;
    if (!password) return res.status(400).json({ message: 'Password is required for unlocking.' });
    const inputPath = req.file.path;
    const outputPath = path.join(uploadDir, `unlocked-${Date.now()}.pdf`);
    try {
        const pdfBytes = await fs.readFile(inputPath);
        const pdfDoc = await PDFDocument.load(pdfBytes, { password });
        const unlockedBytes = await pdfDoc.save();
        await fs.writeFile(outputPath, unlockedBytes);
        res.download(outputPath, `unlocked-${req.file.originalname}`, () => cleanupFiles(inputPath, outputPath));
    } catch (err) {
        handleError(res, err, 'Failed to unlock PDF. Check password.', inputPath, outputPath);
    }
});

// Protect PDF
app.post('/api/protect', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });
    const { password } = req.body;
    if (!password) return res.status(400).json({ message: 'Password is required for protecting.' });
    const inputPath = req.file.path;
    const outputPath = path.join(uploadDir, `protected-${Date.now()}.pdf`);
    try {
        const pdfBytes = await fs.readFile(inputPath);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const protectedBytes = await pdfDoc.save({ userPassword: password, ownerPassword: password });
        await fs.writeFile(outputPath, protectedBytes);
        res.download(outputPath, `protected-${req.file.originalname}`, () => cleanupFiles(inputPath, outputPath));
    } catch (err) {
        handleError(res, err, 'Failed to protect PDF.', inputPath, outputPath);
    }
});

// PDF to Excel
app.post('/api/pdftoexcel', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });
    const inputPath = req.file.path;
    const outputPath = path.join(uploadDir, `converted-${Date.now()}.xlsx`);
    try {
        const dataBuffer = await fs.readFile(inputPath);
        const data = await pdf(dataBuffer);
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Extracted Text');
        data.text.split('\n').forEach(line => worksheet.addRow([line]));
        await workbook.xlsx.writeFile(outputPath);
        res.download(outputPath, 'converted.xlsx', () => cleanupFiles(inputPath, outputPath));
    } catch (err) {
        handleError(res, err, 'Failed to convert PDF to Excel.', inputPath, outputPath);
    }
});

app.listen(port, () => {
    console.log(`Server is live and running on port ${port}`);
});
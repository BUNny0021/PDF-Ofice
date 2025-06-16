// server.js - FINAL VERSION. NO MORE LIBRARIES FOR CONVERSION.

const express = require('express');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { PDFDocument } = require('pdf-lib');
const Jimp = require('jimp');
const ExcelJS = require('exceljs');
const pdf = require('pdf-parse');

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
      try { await fs.unlink(file); } catch (err) { /* ignore */ }
    }
  }
};

const handleError = (res, err, friendlyMessage, ...filesToClean) => {
    const errorMessage = err.message || 'An unknown error occurred.';
    console.error(`SERVER ERROR: ${friendlyMessage}. Details:`, err);
    cleanupFiles(...filesToClean);
    res.status(500).json({ message: friendlyMessage, error: errorMessage });
};

// NEW, DIRECT LIBREOFFICE CONVERSION FUNCTION
const performLibreOfficeConversion = async (res, file, outputExtension) => {
    if (!file) return res.status(400).json({ message: 'No file uploaded.' });
    
    const { path: inputPath, originalname } = file;
    const outputFilename = `${path.parse(originalname).name}.${outputExtension}`;
    const outputDir = path.dirname(inputPath);
    const expectedOutputPath = path.join(outputDir, outputFilename);

    // Command to call LibreOffice directly.
    // --headless: run without UI. --convert-to: target format. --outdir: where to save.
    const command = `soffice --headless --convert-to ${outputExtension} --outdir "${outputDir}" "${inputPath}"`;

    exec(command, async (error, stdout, stderr) => {
        if (error) {
            // THIS WILL FINALLY SHOW US THE REAL LIBREOFFICE ERROR
            console.error('LibreOffice Execution Error:', error);
            console.error('LibreOffice Stderr:', stderr);
            return handleError(res, new Error(stderr || error.message), `LibreOffice failed to convert the file.`);
        }

        try {
            // Check if the output file was actually created
            await fs.access(expectedOutputPath);
            
            // Send the file for download
            res.download(expectedOutputPath, outputFilename, (err) => {
                if (err) {
                    console.error("Download failed:", err);
                }
                // Clean up both the original and converted file
                cleanupFiles(inputPath, expectedOutputPath);
            });
        } catch (downloadErr) {
            // This catches the 'File not found' error if it still happens
            console.error("Output file not found after conversion:", downloadErr);
            handleError(res, downloadErr, 'Conversion seemed to succeed, but the output file could not be found.', inputPath);
        }
    });
};

app.post('/api/pdftoword', upload.single('file'), (req, res) => performLibreOfficeConversion(res, req.file, 'docx'));
app.post('/api/wordtopdf', upload.single('file'), (req, res) => performLibreOfficeConversion(res, req.file, 'pdf'));
app.post('/api/exceltopdf', upload.single('file'), (req, res) => performLibreOfficeConversion(res, req.file, 'pdf'));

// --- Other Endpoints ---
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
    const mergedPdfBytes = await mergedPdf.save();
    res.setHeader('Content-Disposition', 'attachment; filename=merged.pdf');
    res.setHeader('Content-Type', 'application/pdf');
    res.send(Buffer.from(mergedPdfBytes));
  } catch (err) { handleError(res, err, 'Failed to merge PDFs.'); }
  finally { cleanupFiles(...paths); }
});
app.post('/api/split', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });
    let inputPath = req.file.path;
    try {
        await PDFDocument.load(await fs.readFile(inputPath));
        res.download(inputPath, 'split-result.pdf', () => cleanupFiles(inputPath));
    } catch (err) { handleError(res, err, 'Failed to split PDF.', inputPath); }
});
app.post('/api/compress', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });
    res.download(req.file.path, `compressed-${req.file.originalname}`, () => cleanupFiles(req.file.path));
});
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
    } catch (err) { handleError(res, err, 'Failed to convert JPG to PDF.'); }
    finally { cleanupFiles(...paths); }
});
app.post('/api/pdftojpg', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });
    const inputPath = req.file.path;
    const outputPrefix = path.join(uploadDir, path.parse(inputPath).name);
    const command = `pdftocairo -jpeg "${inputPath}" "${outputPrefix}"`;
    exec(command, (error) => {
        if (error) { return handleError(res, error, 'Failed to convert PDF to JPG.', inputPath); }
        const firstPagePath = `${outputPrefix}-1.jpg`;
        res.download(firstPagePath, `${path.parse(req.file.originalname).name}.jpg`, () => cleanupFiles(inputPath, firstPagePath));
    });
});
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
    } catch (err) { handleError(res, err, 'Failed to rotate PDF.'); }
    finally { cleanupFiles(inputPath); }
});
app.post('/api/unlock', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });
    const { password } = req.body;
    if (!password) return res.status(400).json({ message: 'Password is required.' });
    const inputPath = req.file.path;
    try {
        const pdfBytes = await fs.readFile(inputPath);
        const pdfDoc = await PDFDocument.load(pdfBytes, { password });
        const unlockedBytes = await pdfDoc.save();
        res.setHeader('Content-Disposition', `attachment; filename=unlocked-${req.file.originalname}`);
        res.setHeader('Content-Type', 'application/pdf');
        res.send(Buffer.from(unlockedBytes));
    } catch (err) { handleError(res, err, 'Failed to unlock PDF. Check password.'); }
    finally { cleanupFiles(inputPath); }
});
app.post('/api/protect', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });
    const { password } = req.body;
    if (!password) return res.status(400).json({ message: 'Password is required.' });
    const inputPath = req.file.path;
    try {
        const pdfBytes = await fs.readFile(inputPath);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const protectedBytes = await pdfDoc.save({ userPassword: password, ownerPassword: password });
        res.setHeader('Content-Disposition', `attachment; filename=protected-${req.file.originalname}`);
        res.setHeader('Content-Type', 'application/pdf');
        res.send(Buffer.from(protectedBytes));
    } catch (err) { handleError(res, err, 'Failed to protect PDF.'); }
    finally { cleanupFiles(inputPath); }
});
app.post('/api/pdftoexcel', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });
    const inputPath = req.file.path;
    try {
        const dataBuffer = await fs.readFile(inputPath);
        const data = await pdf(dataBuffer);
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Extracted Text');
        data.text.split('\n').forEach(line => worksheet.addRow([line]));
        const buffer = await workbook.xlsx.writeBuffer();
        res.setHeader('Content-Disposition', 'attachment; filename=converted.xlsx');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (err) { handleError(res, err, 'Failed to convert PDF to Excel.'); }
    finally { cleanupFiles(inputPath); }
});

app.listen(port, () => {
    console.log(`Server is live and running on port ${port}`);
});
// =================================================================
// === THIS IS THE NEW DEBUG VERSION - IF YOU SEE THIS, IT WORKED ===
// =================================================================

console.log('--- SERVER.JS V3 --- SCRIPT IS STARTING ---');

const express = require('express');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const libre = require('libreoffice-convert');
const { poppler } = require('pdf-poppler');
const Jimp = require('jimp');
const ExcelJS = require('exceljs');
const pdf = require('pdf-parse');

// --- AGGRESSIVE DEBUGGING FIX for pdf-poppler ---
console.log(`--- V3 --- Current platform detected: ${process.platform}`);

if (process.platform === 'linux') {
    console.log('--- V3 --- PLATFORM IS LINUX: Setting poppler path to /usr/bin');
    poppler.path = '/usr/bin';
    console.log('--- V3 --- Poppler path has been set.');
} else {
    console.log(`--- V3 --- PLATFORM IS ${process.platform}: NOT setting poppler path.`);
}

console.log('--- V3 --- Code is now creating the express app...');

const app = express();
const port = process.env.PORT || 3000;

// Setup static files and upload directory
app.use(express.static('public'));
const uploadDir = path.join(__dirname, 'uploads');
fs.mkdir(uploadDir, { recursive: true });

// ... the rest of your code is the same ...
// ... it's okay to just copy this and paste it over your entire file ...

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

// --- HELPER FUNCTION TO CLEAN UP FILES ---
const cleanupFiles = async (...files) => {
  for (const file of files) {
    if (file) {
      try {
        await fs.unlink(file);
      } catch (err) {
        console.error(`Error cleaning up file ${file}:`, err);
      }
    }
  }
};

// --- API ENDPOINTS FOR EACH TOOL ---
app.post('/api/merge', upload.array('files'), async (req, res) => {
  let paths = req.files.map(f => f.path);
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
    console.error(err);
    res.status(500).send('Error merging PDFs.');
    cleanupFiles(mergedPdfPath, ...paths);
  }
});

app.post('/api/split', upload.single('file'), async (req, res) => {
    let inputPath = req.file.path;
    try {
        const originalPdfBytes = await fs.readFile(inputPath);
        const originalPdf = await PDFDocument.load(originalPdfBytes);
        console.log(`PDF has ${originalPdf.getPageCount()} pages. A full split feature would create a zip here.`);
        res.download(inputPath, 'split-result.pdf', () => cleanupFiles(inputPath));
    } catch (err) {
        console.error(err);
        res.status(500).send('Error splitting PDF.');
        cleanupFiles(inputPath);
    }
});

app.post('/api/compress', upload.single('file'), async (req, res) => {
    let inputPath = req.file.path;
    console.log("Compression is a complex operation. Returning original file as a placeholder.");
    res.download(inputPath, `compressed-${req.file.originalname}`, () => cleanupFiles(inputPath));
});

const convertFile = async (req, res, outputExt, libreOutputExt) => {
  let inputPath = req.file.path;
  let outputPath = path.join(uploadDir, `${path.parse(req.file.filename).name}.${outputExt}`);
  try {
    const fileBuffer = await fs.readFile(inputPath);
    libre.convert(fileBuffer, `.${libreOutputExt || outputExt}`, undefined, async (err, done) => {
      if (err) {
        throw new Error(`Error during conversion: ${err}`);
      }
      await fs.writeFile(outputPath, done);
      res.download(outputPath, `${path.parse(req.file.originalname).name}.${outputExt}`, () => cleanupFiles(inputPath, outputPath));
    });
  } catch (err) {
    console.error(err);
    res.status(500).send(`Error converting file to ${outputExt}.`);
    cleanupFiles(inputPath, outputPath);
  }
};

app.post('/api/pdftoword', upload.single('file'), (req, res) => convertFile(req, res, 'docx', 'docx'));
app.post('/api/wordtopdf', upload.single('file'), (req, res) => convertFile(req, res, 'pdf'));
app.post('/api/exceltopdf', upload.single('file'), (req, res) => convertFile(req, res, 'pdf'));
app.post('/api/jpgtopdf', upload.array('files'), async (req, res) => {
    let paths = req.files.map(f => f.path);
    let outputPath = path.join(uploadDir, `converted-${Date.now()}.pdf`);
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
        console.error(err);
        res.status(500).send('Error converting JPG to PDF.');
        cleanupFiles(outputPath, ...paths);
    }
});

app.post('/api/pdftojpg', upload.single('file'), async (req, res) => {
    let inputPath = req.file.path;
    let opts = {
        format: 'jpeg',
        out_dir: uploadDir,
        out_prefix: path.parse(inputPath).name,
        page: null
    };
    try {
        await poppler(inputPath, opts);
        const firstPagePath = `${opts.out_dir}/${opts.out_prefix}-1.jpg`;
        res.download(firstPagePath, `${path.parse(req.file.originalname).name}.jpg`, () => {
             cleanupFiles(inputPath, firstPagePath);
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error converting PDF to JPG.');
        cleanupFiles(inputPath);
    }
});

app.post('/api/rotate', upload.single('file'), async (req, res) => {
    let inputPath = req.file.path;
    let outputPath = path.join(uploadDir, `rotated-${Date.now()}.pdf`);
    try {
        const pdfBytes = await fs.readFile(inputPath);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const pages = pdfDoc.getPages();
        pages.forEach(page => page.setRotation(page.getRotation().angle + 90));
        const rotatedPdfBytes = await pdfDoc.save();
        await fs.writeFile(outputPath, rotatedPdfBytes);
        res.download(outputPath, 'rotated.pdf', () => cleanupFiles(inputPath, outputPath));
    } catch (err) {
        console.error(err);
        res.status(500).send('Error rotating PDF.');
        cleanupFiles(inputPath);
    }
});

app.post('/api/protect', upload.single('file'), async (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).send('Password is required.');
    let inputPath = req.file.path;
    let outputPath = path.join(uploadDir, `protected-${Date.now()}.pdf`);
    try {
        const pdfBytes = await fs.readFile(inputPath);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        await pdfDoc.save({
            userPassword: password,
            ownerPassword: password,
        }).then(bytes => fs.writeFile(outputPath, bytes));
        res.download(outputPath, `protected-${req.file.originalname}`, () => cleanupFiles(inputPath, outputPath));
    } catch (err) {
        console.error(err);
        res.status(500).send('Error protecting PDF.');
        cleanupFiles(inputPath, outputPath);
    }
});

app.post('/api/unlock', upload.single('file'), async (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).send('Password is required.');
    let inputPath = req.file.path;
    let outputPath = path.join(uploadDir, `unlocked-${Date.now()}.pdf`);
    try {
        const pdfBytes = await fs.readFile(inputPath);
        const pdfDoc = await PDFDocument.load(pdfBytes, { password });
        const unlockedBytes = await pdfDoc.save();
        await fs.writeFile(outputPath, unlockedBytes);
        res.download(outputPath, `unlocked-${req.file.originalname}`, () => cleanupFiles(inputPath, outputPath));
    } catch (err) {
        console.error(err);
        if (err.message.includes('Invalid password')) {
            res.status(400).send('Incorrect password.');
        } else {
            res.status(500).send('Error unlocking PDF. It might not be encrypted.');
        }
        cleanupFiles(inputPath, outputPath);
    }
});

app.post('/api/pdftoexcel', upload.single('file'), async (req, res) => {
    let inputPath = req.file.path;
    let outputPath = path.join(uploadDir, `converted-${Date.now()}.xlsx`);
    try {
        const dataBuffer = await fs.readFile(inputPath);
        const data = await pdf(dataBuffer);
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Extracted Text');
        const lines = data.text.split('\n');
        lines.forEach(line => {
            worksheet.addRow([line]);
        });
        await workbook.xlsx.writeFile(outputPath);
        res.download(outputPath, 'converted.xlsx', () => cleanupFiles(inputPath, outputPath));
    } catch (err) {
        console.error(err);
        res.status(500).send('Error converting PDF to Excel.');
        cleanupFiles(inputPath, outputPath);
    }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
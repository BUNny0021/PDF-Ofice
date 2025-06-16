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

// --- FIX: Configure pdf-poppler for Linux Environment ---
// The 'pdf-poppler' library needs an explicit path to the poppler binaries on Linux.
// We installed these tools to '/usr/bin' in our Dockerfile.
if (process.platform === 'linux') {
    poppler.path = '/usr/bin';
}

const app = express();
const port = process.env.PORT || 3000;

// Setup static files and upload directory
app.use(express.static('public'));
const uploadDir = path.join(__dirname, 'uploads');
fs.mkdir(uploadDir, { recursive: true }); // Ensure upload directory exists

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

// 1. Merge PDF
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

// 2. Split PDF
app.post('/api/split', upload.single('file'), async (req, res) => {
    // Note: A full split UI is complex (selecting ranges). This is a simple split-all-pages example.
    // For a real app, you'd send page ranges from the client.
    let inputPath = req.file.path;
    try {
        const originalPdfBytes = await fs.readFile(inputPath);
        const originalPdf = await PDFDocument.load(originalPdfBytes);
        // This is a placeholder. A real app would generate a zip of single pages.
        // For simplicity, we'll just send the original back.
        console.log(`PDF has ${originalPdf.getPageCount()} pages. A full split feature would create a zip here.`);
        res.download(inputPath, 'split-result.pdf', () => cleanupFiles(inputPath));
    } catch (err) {
        console.error(err);
        res.status(500).send('Error splitting PDF.');
        cleanupFiles(inputPath);
    }
});


// 3. Compress PDF - Placeholder, as true compression is complex and often requires Ghostscript
app.post('/api/compress', upload.single('file'), async (req, res) => {
    // True PDF compression is very hard without external tools like Ghostscript.
    // This is a placeholder. It will just return the original PDF.
    let inputPath = req.file.path;
    console.log("Compression is a complex operation. Returning original file as a placeholder.");
    res.download(inputPath, `compressed-${req.file.originalname}`, () => cleanupFiles(inputPath));
});

// 4. Convert PDF to Word/JPG/Excel (using libreoffice and poppler)
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

// 5. Convert Word/Excel to PDF
app.post('/api/wordtopdf', upload.single('file'), (req, res) => convertFile(req, res, 'pdf'));
app.post('/api/exceltopdf', upload.single('file'), (req, res) => convertFile(req, res, 'pdf'));


// 6. JPG to PDF
app.post('/api/jpgtopdf', upload.array('files'), async (req, res) => {
    let paths = req.files.map(f => f.path);
    let outputPath = path.join(uploadDir, `converted-${Date.now()}.pdf`);
    try {
        const pdfDoc = await PDFDocument.create();
        for (const imgPath of paths) {
            const img = await Jimp.read(imgPath);
            const imgBytes = await img.getBufferAsync(Jimp.MIME_PNG); // Convert to a standard format
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

// 7. PDF to JPG
app.post('/api/pdftojpg', upload.single('file'), async (req, res) => {
    let inputPath = req.file.path;
    let opts = {
        format: 'jpeg',
        out_dir: uploadDir,
        out_prefix: path.parse(inputPath).name,
        page: null // convert all pages
    };
    try {
        // Poppler creates files named like: prefix-1.jpg, prefix-2.jpg
        await poppler(inputPath, opts);
        // For simplicity, we'll send back the first page. A real app would zip all pages.
        const firstPagePath = `${opts.out_dir}/${opts.out_prefix}-1.jpg`;
        res.download(firstPagePath, `${path.parse(req.file.originalname).name}.jpg`, () => {
             // Basic cleanup. A more robust solution would list all generated files and delete them.
             cleanupFiles(inputPath, firstPagePath);
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error converting PDF to JPG.');
        cleanupFiles(inputPath);
    }
});


// 8. Rotate PDF
app.post('/api/rotate', upload.single('file'), async (req, res) => {
    let inputPath = req.file.path;
    let outputPath = path.join(uploadDir, `rotated-${Date.now()}.pdf`);
    try {
        const pdfBytes = await fs.readFile(inputPath);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const pages = pdfDoc.getPages();
        // Rotating every page by 90 degrees clockwise.
        // A real app would get the angle from the request body.
        pages.forEach(page => page.setRotation(page.getRotation().angle + 90));
        const rotatedPdfBytes = await pdfDoc.save();
        await fs.writeFile(outputPath, rotatedPdfBytes);
        res.download(outputPath, 'rotated.pdf', () => cleanupFiles(inputPath, outputPath));
    } catch (err) {
        console.error(err);
        res.status(500).send('Error rotating PDF.');
        cleanupFiles(inputPath, outputPath);
    }
});

// 9 & 10. Protect / Unlock PDF
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
            ownerPassword: password, // You can set a different owner password
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
        const pdfDoc = await PDFDocument.load(pdfBytes, { password }); // Try to load with password
        const unlockedBytes = await pdfDoc.save();
        await fs.writeFile(outputPath, unlockedBytes);

        res.download(outputPath, `unlocked-${req.file.originalname}`, () => cleanupFiles(inputPath, outputPath));
    } catch (err) {
        console.error(err);
        // pdf-lib throws a specific error for wrong passwords
        if (err.message.includes('Invalid password')) {
            res.status(400).send('Incorrect password.');
        } else {
            res.status(500).send('Error unlocking PDF. It might not be encrypted.');
        }
        cleanupFiles(inputPath, outputPath);
    }
});

// 11. PDF to Excel (Basic text extraction)
app.post('/api/pdftoexcel', upload.single('file'), async (req, res) => {
    let inputPath = req.file.path;
    let outputPath = path.join(uploadDir, `converted-${Date.now()}.xlsx`);
    try {
        const dataBuffer = await fs.readFile(inputPath);
        const data = await pdf(dataBuffer);

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Extracted Text');
        
        // Split text by lines and add to worksheet rows
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
  console.log(`Server running at http://localhost:${port}`);
});
These files are manufactured test invoices, not user documents or company data.
They are checked in so npm test works from a clean checkout without Python,
external fonts, internet downloads or any preparatory generation step.

expected.json contains the known invoice fields. The text PDF and missing-date
PDF exercise the text parser. PNG and 1-bit PNG exercise the local OCR decoder.
The scan/logo and mixed PDFs exercise per-page fallback and page composition.
synthetic-split.pdf shows the same scanned invoice as two positioned raster
strips; OCR must render the complete visible page, not select one XObject.

The original synthetic data was created by scripts/create-ocr-fixtures.py.
No downloaded documents, actual supplier details or working database are used.

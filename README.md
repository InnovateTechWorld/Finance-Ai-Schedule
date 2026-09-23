# Finance AI Schedule

Finance AI Schedule is a document-driven workflow for turning scattered financial records into organized, reviewable schedules.

It is designed for teams and individuals who work with bank statements, invoices, receipts, and supporting documents and want a faster way to convert raw files into structured financial data without doing everything manually.

Instead of copying values from PDFs and spreadsheets by hand, the application reads uploaded documents, extracts relevant financial information, builds a working schedule, and gives the user a clear place to review, correct, and export the final result.

## Why this project exists

Financial preparation work is often repetitive, time-consuming, and error-prone.

Common problems include:

- large numbers of uploaded documents
- manually retyping figures from statements and invoices
- inconsistent formatting across source files
- difficulty checking whether extracted values are complete and correct
- needing to revise outputs after a first pass

This project addresses those problems by combining AI extraction, structured review, and export-ready outputs in one workflow.

## What the app does

The application helps users:

- upload source documents such as PDFs, images, and text-based files
- extract relevant financial details using AI
- organize the information into a schedule or table
- review extracted values with confidence indicators and direct edit controls
- revise results using natural-language feedback or manual corrections
- export the final schedule as a spreadsheet or PDF preview

The user experience is built around a simple flow:

1. Upload documents
2. Let the system analyze them
3. Review generated schedule entries
4. Fix values where needed
5. Export or continue refining

## Typical use cases

This project is useful for a wide range of finance and accounting tasks, including:

- VAT and tax schedule preparation
- withholding tax summaries
- invoice-to-schedule processing
- payment and expense tracking
- reconciliations from statements and supporting records
- review of extracted accounting figures before finalization
- internal finance documentation and reporting workflows

It is especially helpful when a person needs to work quickly with many documents but still wants to validate the output before final submission.

## Core workflow

The system follows a practical document-processing pattern:

### 1. Ingest
The app accepts multiple file types and converts them into a form that the AI can process reliably.

### 2. Extract
The model reads the uploaded content and identifies key financial values, labels, dates, totals, and related entries.

### 3. Structure
The extracted content is organized into rows and columns that match the intended schedule format.

### 4. Review
The generated output is shown in an editable interface so the user can correct mistakes, confirm totals, or refine specific fields.

### 5. Export
The final result can be downloaded in spreadsheet format and previewed as a PDF-style document.

## Key features

- multi-file upload workflow
- AI-assisted data extraction from financial documents
- structured schedule generation
- editable financial tables
- inline review of uncertain values
- natural-language revision flow
- saved sessions for continuing previous work
- export-ready workbook and preview output

## Project purpose in plain terms

This project is meant to reduce the effort of converting raw financial documents into usable accounting output.

Instead of starting from a blank sheet and manually reading every document, a user can upload files and receive a draft schedule that is much closer to a final result. The tool does not replace judgment; it helps accelerate the process while keeping the user in control.

## Getting started

### Requirements

- Node.js
- package manager such as npm

### Install and run

```bash
npm install
cp .env.example .env.local
npm run dev
```

Then open the local application in your browser.

## Configuration

Create a local environment file based on the sample configuration and fill in the required keys for your chosen AI and file-processing services.

The project expects configuration for:

- the AI model used for document extraction
- the model identifier
- any required API key or bearer token
- a document conversion or rendering service

Example variables may include:

- `MODEL_API_KEY`
- `MODEL_ID`
- `FILE_CONVERSION_API_KEY`
- `FILE_CONVERSION_URL`
- other service-specific settings depending on your deployment

The exact values depend on the environment where the application is running.

## Saved work and review flow

The application keeps recent sessions so users can revisit previous outputs without starting over. This makes it useful for iterative finance work, where a first extraction may need refinement before final export.

The review process encourages users to validate the generated schedule before finalizing it. This helps catch errors early and reduces the risk of exporting incorrect financial values.

## Deployment notes

The project is designed to run as a web application and can be deployed in a standard hosting environment that supports a Node-based application and environment variables.

For production use, it is best to:

- protect API keys and sensitive environment variables
- keep conversion services available and reliable
- validate file sizes and uploaded document counts
- review extracted values before final reporting

## Folder structure

```text
app/
  page.tsx                  main user flow for upload, review, and export
  api/                      request routes for processing, revision, and artifact access
lib/
  ingest.ts                 file intake and document preparation
  llm.ts                    AI interaction layer
  schema.ts                 financial row and field structure
  xlsx.ts                   spreadsheet generation logic
  converter.ts              file conversion and preview preparation
  events.ts                 shared event and response definitions
```

## Summary

Finance AI Schedule is a practical AI-assisted financial document workflow. It is built to help people move faster from raw files to structured, reviewable financial schedules without losing control over the final result.

The main goal is simple: turn a pile of financial documents into a cleaner, more usable, and more trustworthy schedule with less manual effort.

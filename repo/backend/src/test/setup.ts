/**
 * Global test setup — runs once before all backend test files.
 * Keeps the test environment deterministic by pinning Date if needed.
 */

// Ensure upload dir exists for tests that exercise file handling.
import { mkdirSync } from 'fs';

const uploadDir = process.env['UPLOAD_DIR'] ?? '/tmp/retail_hub_test_uploads';
mkdirSync(uploadDir, { recursive: true });

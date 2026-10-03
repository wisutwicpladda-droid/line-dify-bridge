# line-dify-bridge

## Product validation and LINE QA

The bridge refreshes the public Product master on `PRODUCT_MASTER_SYNC_MIN` (default 60 minutes). Each refresh runs `product_validator.js` across product identity, common name/active ingredient, status, Strategy, image mapping, and usage rows. Validation does not expose unreleased product details or stop the bridge; errors and warnings are logged and summarized at the root health endpoint under `productValidation`.

Run the local contracts before deploying:

```powershell
node tests/product_validation_check.js
node tests/sheet_context_check.js
node tests/image_support_check.js C:\Users\artwi\OneDrive\Documents\ChatGPT\น้องลัดดา
node tests/line_qa_check.js C:\Users\artwi\OneDrive\Documents\ChatGPT\น้องลัดดา
node tests/regression_check_p88.js C:\Users\artwi\OneDrive\Documents\ChatGPT\น้องลัดดา
```

`tests/line_qa_cases.json` is the fixed integration checklist for the LINE bridge: rice red rice/barnyard grass, multiple Strategy candidates, unreleased products, competitor comparison, and greeting images. Send these cases through the real LINE account when a test recipient is selected; do not put channel tokens or user IDs in the repository.

# line-dify-bridge

## Product validation and LINE QA

The bridge refreshes the public Product master on `PRODUCT_MASTER_SYNC_MIN` (default 60 minutes). Each refresh runs `product_validator.js` across product identity, common name/active ingredient, status, Strategy, image mapping, and usage rows. Validation does not expose unreleased product details or stop the bridge; errors and warnings are logged and summarized at the root health endpoint under `productValidation`.

Run every test before merging to main (Railway deploys on merge):

```powershell
npm test
```

The tests run locally against mock LINE, Dify and Knowledge servers and need no real keys. tests/README.md lists what each one covers.

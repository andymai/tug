# The Chrome Web Store

The `Extension` workflow sends each release's `dist/chrome-web-store` build to the Chrome Web Store with `scripts/publish-extension.py`. A version goes to the store only when its package differs from the package of the store's version, which each release keeps as an asset. It waits while the store holds another version back. The store reviews each version before users get it.

The store's API can't make a new item. So the first version goes up by hand, once, with the steps below. Until the repository variables in step 3 exist, the workflow skips the store. Do the steps in order: a store version that goes public before Tug lets in the store's ID can't reach Tug.

## 1. Make the item

1. Turn on 2-Step Verification for the Google account.
2. Register in the [Developer Dashboard](https://chrome.google.com/webstore/devconsole). Registration has a one-time fee.
3. Build the store's package:

   ```sh
   pnpm --filter @tug/extension build
   (cd apps/extension/dist/chrome-web-store && zip -qrX ../tug-extension-chrome-web-store.zip .)
   ```

4. Click **Add new item**, and upload `apps/extension/dist/tug-extension-chrome-web-store.zip`.
5. Fill in the **Store listing**, **Privacy** and **Distribution** tabs from [listing.md](listing.md), with the images in this folder.
6. Click **Save draft**. Don't submit the item yet.

## 2. Give the release builds the store's ID

The store gives the item its own ID. The zip on each release must have the same ID, because Tug's native messaging manifest names the IDs that it lets in.

1. On the item's **Package** tab, click **View public key**.
2. Put the key, on one line without the `BEGIN` and `END` lines, in `CHROMIUM_KEY` in `apps/extension/src/manifest.ts`.
3. Change the comment above `CHROMIUM_KEY`: the store holds the private half now.
4. Put the item's ID in `CHROMIUM_ID` there, and add it to `CHROMIUM_ORIGINS` in `apps/desktop/src-tauri/src/browsers.rs`. Keep the old ID in `CHROMIUM_ORIGINS`, so the extensions that people loaded from a zip still reach Tug.
5. Merge the change, and wait for its release.

## 3. Let the workflow publish

The workflow gets a short-lived token through Workload Identity Federation, so no key goes into the repository. Only `extension.yml`, run from `main`, can get the token, and it sends only a commit on `main`.

1. Open [Cloud Shell](https://shell.cloud.google.com), and run these commands. Change `PROJECT` to a new, unique project ID.

   ```sh
   PROJECT=tug-chrome-web-store
   gcloud projects create "$PROJECT"
   gcloud config set project "$PROJECT"
   gcloud services enable chromewebstore.googleapis.com iamcredentials.googleapis.com sts.googleapis.com
   gcloud iam service-accounts create publisher --display-name="Tug's Chrome Web Store releases"
   gcloud iam workload-identity-pools create github --location=global --display-name="GitHub Actions"
   gcloud iam workload-identity-pools providers create-oidc tug-extension --location=global --workload-identity-pool=github \
     --display-name="andymai/tug" \
     --issuer-uri="https://token.actions.githubusercontent.com" \
     --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
     --attribute-condition="assertion.job_workflow_ref == 'andymai/tug/.github/workflows/extension.yml@refs/heads/main' && assertion.ref == 'refs/heads/main'"
   NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
   gcloud iam service-accounts add-iam-policy-binding "publisher@$PROJECT.iam.gserviceaccount.com" \
     --role=roles/iam.workloadIdentityUser \
     --member="principalSet://iam.googleapis.com/projects/$NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/andymai/tug"
   echo "CWS_SERVICE_ACCOUNT=publisher@$PROJECT.iam.gserviceaccount.com"
   echo "CWS_WORKLOAD_IDENTITY_PROVIDER=projects/$NUMBER/locations/global/workloadIdentityPools/github/providers/tug-extension"
   ```

2. In the Developer Dashboard, go to **Account**, and add the service account's email.
3. Find the publisher ID in **Publisher** > **Settings**.
4. Set the repository variables. Set `CWS_ITEM_ID` last, because it turns on the store job.

   ```sh
   gh variable set CWS_SERVICE_ACCOUNT --body "publisher@PROJECT.iam.gserviceaccount.com"
   gh variable set CWS_WORKLOAD_IDENTITY_PROVIDER --body "projects/NUMBER/locations/global/workloadIdentityPools/github/providers/tug-extension"
   gh variable set CWS_PUBLISHER_ID --body "PUBLISHER_ID"
   gh variable set CWS_ITEM_ID --body "ITEM_ID"
   ```

## 4. Submit the first version

In the Developer Dashboard, click **Submit for review**. After that, each release with a changed package goes to the store by itself. Only release-please sends a tag to the workflow, so a person can't send a tag that skipped review.

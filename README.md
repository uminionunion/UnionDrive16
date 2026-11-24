# UnionDrive #16

UnionDrive #16 is a responsive ride-hailing app prototype built for the web and installable as a Progressive Web App (PWA) on supported Android and iPhone browsers.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. To create and preview a production build:

```sh
npm run build
npm run preview
```

## Included in this prototype

- Rider booking flow with pickup and destination entry, ride choices, fare estimates, and a simulated active ride.
- Three simulated wallets: the customer pays 100% of the fare accepted by the driver; Union Wallet routes the payment, keeps 20%, and transfers 80% to Driver Wallet.
- Ride history, wallet balances, and wallet transactions saved in the current browser on the current device. Cancelling a demo ride refunds the fare and reverses the payout.
- Switchable light and dark themes, with the selected appearance saved on the current device.
- Driver view with an online/offline demo toggle.
- Responsive layouts, an illustrated map preview, and a PWA manifest/service worker for installation and basic offline caching.

## Install on a phone

Deploy the production build to a host that serves the app over HTTPS. On Android, open the site in Chrome and choose **Install app** or **Add to Home screen**. On iPhone, open it in Safari, tap **Share**, then **Add to Home Screen**.

## Production integrations still required

This is a working UI prototype, not a live ride-dispatch service. The map, driver match, ride completion, fare estimates, and wallet top-ups are illustrative; no real money is moved. Real rides require a secure backend for accounts, dispatch, location and routing, driver verification, trip state, and support. Real payments require a payment provider and server-side processing. Do not collect real payment details in this prototype.

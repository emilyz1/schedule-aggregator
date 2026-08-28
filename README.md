# Scheduler — when2meet+

Aggregate weekly availability across months. Supports recurring and one-off conflicts with descriptions.

## Features

- **Recurring conflicts** — mark weekly blocks (e.g. "every Monday 9–10am, standup")
- **One-off conflicts** — mark a specific date (e.g. "Sept 14, dentist")
- **Hard vs. soft severity** — distinguish fixed blocks from flexible ones
- **Aggregate heatmap** — one view collapsing all weeks into Mon–Sun × time
- **Specific week view** — zoom into a particular week's data
- **Best times suggestion** — auto-highlights 3 meeting slots with fewest conflicts
- **Real-time** — heatmap updates live as teammates add conflicts
- **Ownership protection** — only you can delete your own conflicts (via session key)

---

## Setup

### 1. Firebase project

1. Go to [https://console.firebase.google.com](https://console.firebase.google.com) and create a new project.
2. In the project, go to **Firestore Database** → **Create database** → choose a region → Start in **test mode** (you'll apply rules below).
3. Go to **Project Settings** → **Your apps** → click **Add app** → choose **Web** (</>) → register the app.
4. Copy the `firebaseConfig` object shown.

### 2. Paste your config

Open `js/firebase-config.js` and replace the placeholder values:

```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "...",
  appId: "..."
}
```

### 3. Apply Firestore security rules

In Firebase Console → **Firestore Database** → **Rules**, replace the default rules with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /groups/{groupId} {
      allow read, write: if true;
    }
    match /conflicts/{conflictId} {
      allow read:   if true;
      allow create: if true;
      // Update (including soft-delete) only succeeds if the client provides
      // the matching sessionKey — enforces ownership without requiring auth.
      allow update: if request.resource.data.sessionKey == resource.data.sessionKey;
      allow delete: if false;
    }
  }
}
```

### 4. Deploy to GitHub Pages

1. Push this repository to GitHub.
2. Go to the repo → **Settings** → **Pages**.
3. Set **Source** to `Deploy from a branch`, branch `main`, folder `/ (root)`.
4. Click **Save**. Your site will be live at `https://<username>.github.io/<repo-name>/`.

---

## How to use

1. Open `index.html`, enter a group name and date range → **Create Group**.
2. Copy the URL and share it with your group.
3. Each person opens the link, enters their name, and adds conflicts.
4. The aggregate heatmap updates in real time — green = everyone free, red = everyone busy.
5. Click any cell to see a detailed list of who has conflicts and why.

---

## Data model

**`groups/{id}`**
| Field | Type | Description |
|---|---|---|
| `name` | string | Group display name |
| `dateRange.start` | string | `YYYY-MM-DD` |
| `dateRange.end` | string | `YYYY-MM-DD` |

**`conflicts/{id}`**
| Field | Type | Description |
|---|---|---|
| `groupId` | string | Parent group |
| `userName` | string | Submitter's display name |
| `sessionKey` | string | Random UUID (stored in browser localStorage); used to verify ownership |
| `type` | `"recurring"` \| `"oneoff"` | |
| `dayOfWeek` | number | Display index 0=Mon…6=Sun (recurring only) |
| `date` | string | `YYYY-MM-DD` (one-off only) |
| `startTime` | string | `HH:MM` |
| `endTime` | string | `HH:MM` |
| `severity` | `"hard"` \| `"soft"` | |
| `description` | string | Short description of the conflict |
| `deleted` | boolean | Soft-delete flag |

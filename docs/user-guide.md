# User guide

## A typical day

1. **Morning**: open the app (it works offline). The dashboard shows today's queue, follow-ups due, overdue dues and low stock, and the bell in the header counts what needs attention.
2. **Patient arrives**: find the patient under **Patients**, or add one with **+ New patient**. If they have an appointment, mark it **Arrived** in Today's queue to give them a token. **Start visit** opens the case form.
3. **Visit**: write the case notes, then add remedies by typing a few letters and pressing Enter. Pick the stock item and quantity to dispense and set a follow-up date. Finish with **Save & print Rx** or **Save & bill**.
4. **Billing**: the bill is prefilled with the consultation fee and the dispensed medicines. Enter the amount paid now. Any balance gets a due date and appears under **Billing → Dues**. Use **+ Medicine from stock** for a counter sale; voiding or editing the bill returns the stock.
5. **Evening**: review **Reports → OP Register** for the day and today's collection on the dashboard.

## Case notes

- **Complaints**: each complaint is a card with the **Complaint** (one line, e.g. "Throbbing headache, right temple"), its **Duration** (e.g. 3 months), any number of **Aggravation (<)** and **Amelioration (>)** entries, and what the complaint started after under **Ailments from (A/F)**. For these, type an entry and press Enter or **Add**, or tap a quick pick (Morning, Cold, Open air, Motion and so on; Grief, Fright, Injury and so on for ailments from) to add it; tap it again, or the × on its chip, to remove it. Terms you used in earlier visits are suggested as you type. Press **+ Add complaint** for another card and **×** to remove one. Each card is also saved as one summary line, such as "Throbbing headache, right temple; since 3 months; < sun, noise; > pressure; A/F grief", which is what appears on prescriptions, certificates, reports and the visit history. Complaints saved as plain lines before the cards existed open as cards with the line in **Complaint**. There is no separate Modalities tab. Modalities notes saved on older visits are no longer shown in the visit form, but they stay in the record and in **Export all data**.
- **History**: the History tab has separate **Past history** and **Family history** boxes. History written before the split appears under Past history.
- **Previous complaints**: on a follow-up visit, the previous visit's complaints are listed with **Persists / Better / Worsened / Resolved**. Complaints not marked Resolved carry forward to the next follow-up. The statuses appear in the patient's visit history.
- **Generals**: a new visit starts with every row set to Normal (Appetite, Thirst, Urine, Sweat Normal; Sleep Sound; Stool Regular), so tap only what differs. An existing visit shows what was saved. Pick Appetite, Thirst, Urine (several allowed), Sleep, Stool (with days between stools for constipation) and Sweat (with the body part when increased). Click a selected option again to clear it. Anything else goes in **Other generals**. These are kept in the record and are not printed on the prescription.
- **Deleting a visit**: open the visit and press **Delete visit**. Its prescription is removed and dispensed medicines go back to stock. A visit cannot be deleted while a later follow-up visit, an active bill, a certificate or an attachment still refers to it; the dialog lists what to delete, void or cancel first.

## Patient page

- **Diagnosis**: record one or more diagnoses per patient. Type one and press Enter, and remove one with the × on its chip. Diagnoses used for other patients are suggested as you type.
- **WhatsApp**: choose a message template and press **Send WhatsApp**. WhatsApp opens with the message filled in, and you review it and press Send yourself. The patient needs a valid Indian mobile number.

## OP numbers

New patients are numbered automatically using the format under **Settings → Clinic → OP numbers**. Click the tags to build a format. Hover over a tag (or tab to it) to see what it means, or click **Show examples** for a table and some ready-made formats.

| Format | Example | Restarts |
|---|---|---|
| `OP-{YYYY}-{N:5}` (default) | `OP-2026-00183` | every year |
| `{YY}{N:4}` | `260183` | every year |
| `{YY}{MM}{N:3}` | `2611183` | every month |
| `{N}` | `183` | never |

`{N}` is the running number and must appear once. `{N:4}` pads it with zeros to 4 digits. Any other text, or none, is printed as it is.

The next number is one after the highest number already used in the current year (or month), on any device. To carry on from a paper register, enter the next number in **Next OP number**, e.g. 184. Changing the format doesn't change existing patients' numbers.

If two devices give out the same number while offline, the patient created later is renumbered at the next sync. A banner shows the change with a link to reprint the OP slip. Every change to a patient's OP number, by hand or by sync, is listed under the number on the patient page.

## WhatsApp templates

Manage templates under **Settings → WhatsApp**. Each template has a name and a message. Click a placeholder button to insert it at the cursor. When the message is sent, each placeholder is replaced:

| Placeholder | Replaced with |
|---|---|
| `{name}` | Patient's name |
| `{opNo}` | Patient's OP number |
| `{clinic}` | Clinic name |
| `{doctor}` | Doctor's name |
| `{phone}` | Clinic phone number |
| `{date}` | Today's date |

The due-payment reminder (sent from the dues list) also supports `{balance}` and `{dueDate}`.

## Sync

Every change is saved on the device first. When online, the app syncs to Google Drive:

- about 30 seconds after an edit;
- when the tab is hidden;
- when the device comes back online;
- when you press **Sync now** (the chip in the header).

Each device must sign in with the same Google account. If two devices change the same record, the newer edit wins. Duplicate OP or bill numbers are renumbered with a notice (see [OP numbers](#op-numbers)). A banner warns you if another device was active in the last few minutes.

## Encryption

**Settings → Sync & storage → Encrypt Drive backup** encrypts the Drive copy with a passphrase. Other devices ask for the passphrase once.

> **Warning:** if the passphrase is forgotten, the Drive copy cannot be recovered. Devices that still hold the data locally are not affected.

**Forgot the passphrase?** Use **Forgot the passphrase?** in the passphrase banner (or **Forgot passphrase? Replace Drive backup** in Settings). This deletes the encrypted Drive copy and uploads the data on this device in its place, optionally with a new passphrase. Other devices then ask for the new passphrase and merge their own data back in. Records that existed only in the old Drive copy, and attachment files this device never downloaded, are lost. Do this on the device with the most complete data.

### Where the backup lives on Drive

The app stores its files in Google Drive's hidden **app data** folder (it only has the `drive.appdata` permission). They do not appear in **My Drive** and cannot be opened directly. To see that the app holds data, or to delete it all, open drive.google.com → **Settings** (gear) → **Manage apps** → the app (the name on your Google OAuth consent screen) → **Options** → **Delete hidden app data**. Use **Download a backup file** for a copy you can open yourself.

## Backups

Drive sync acts as a continuous backup. In addition:

- **Download a backup file (.json)** saves everything, optionally including attachments.
- **Import backup** merges a backup file back in. Newer records win, and nothing is deleted.
- **Export all data to Excel** writes a workbook for accounting or record keeping.

Keeping a periodic copy outside Google Drive is recommended. Clearing the browser's site data deletes the local copy, so sync before doing so.

## Installing the app

- **Chrome or Edge (desktop)**: use the install button in the address bar.
- **Android**: open the browser menu and choose **Install app**.
- **iPhone or iPad**: in Safari, tap **Share → Add to Home Screen**.

After the first visit the app works offline. When a new version is deployed, the app shows **A new version is available → Update**. It never reloads by itself during a visit.

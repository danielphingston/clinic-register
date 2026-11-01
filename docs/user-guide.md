# User guide

## A typical day

1. **Morning**: open the app (it works offline). The dashboard shows today's queue, follow-ups due, overdue dues and low stock, and the bell in the header counts what needs attention.
2. **Patient arrives**: find the patient under **Patients**, or add one with **+ New patient**. If they have an appointment, mark it **Arrived** in Today's queue to give them a token. **Start visit** opens the case form.
3. **Visit**: write the case notes, then add remedies by typing a few letters and pressing Enter. Pick the stock item and quantity to dispense and set a follow-up date. Finish with **Save & print Rx** or **Save & bill**.
4. **Billing**: the bill is prefilled with the consultation fee and the dispensed medicines. Enter the amount paid now. Any balance gets a due date and appears under **Billing → Dues**. Use **+ Medicine from stock** for a counter sale; voiding or editing the bill returns the stock.
5. **Evening**: review **Reports → OP Register** for the day and today's collection on the dashboard.

## Case notes

- **Complaints**: each complaint is a card with **Location** (e.g. head, right temple), **Sensation**, **Duration** (duration or onset), **Worse (<)** and **Better (>)** modalities, **Concomitants** and **Other notes**. All fields are optional. Press **+ Add complaint** for another card and **×** to remove one. For Worse and Better, type free text or tap the quick picks (Morning, Cold, Open air, Motion and so on) to add a term; tap it again to remove it. Terms you used in earlier visits are suggested as you type. Each card is also saved as one summary line, such as "Head, right temple: throbbing; since 3 months; < sun, noise; with nausea", which is what appears on prescriptions, certificates, reports and the visit history. Complaints saved as plain lines before the cards existed open with the line in **Other notes**.
- **Previous complaints**: on a follow-up visit, the previous visit's complaints are listed with **Persists / Better / Worsened / Resolved**. Complaints not marked Resolved carry forward to the next follow-up. The statuses appear in the patient's visit history.
- **Generals**: a new visit starts with every row set to Normal (Appetite, Thirst, Urine, Sweat Normal; Sleep Sound; Stool Regular), so tap only what differs. An existing visit shows what was saved. Pick Appetite, Thirst, Urine (several allowed), Sleep, Stool (with days between stools for constipation) and Sweat (with the body part when increased). Click a selected option again to clear it. Anything else goes in **Other generals**. These are kept in the record and are not printed on the prescription.

## Patient page

- **Diagnosis**: record one or more diagnoses per patient. Type one and press Enter, and remove one with the × on its chip. Diagnoses used for other patients are suggested as you type.
- **WhatsApp**: choose a message template and press **Send WhatsApp**. WhatsApp opens with the message filled in, and you review it and press Send yourself. The patient needs a valid Indian mobile number.

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

Each device must sign in with the same Google account. If two devices change the same record, the newer edit wins. Duplicate OP or bill numbers are renumbered with a notice. A banner warns you if another device was active in the last few minutes.

## Encryption

**Settings → Sync & storage → Encrypt Drive backup** encrypts the Drive copy with a passphrase. Other devices ask for the passphrase once.

> **Warning:** if the passphrase is forgotten, the Drive copy cannot be recovered. Devices that still hold the data locally are not affected.

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

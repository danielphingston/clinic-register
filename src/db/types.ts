// Every synced record carries these fields. `deleted` is a tombstone so
// deletions propagate through Drive sync instead of being lost.
export interface BaseRecord {
  id: string
  createdAt: number
  updatedAt: number
  deleted: 0 | 1
}

export type Sex = 'M' | 'F' | 'O'

export interface Patient extends BaseRecord {
  opNo: string
  name: string
  dob?: string // ISO date
  age?: number // used when DOB unknown
  ageAsOf?: string // ISO date the age was recorded, so it can advance over time
  sex?: Sex
  phone?: string
  address?: string
  notes?: string
  diagnoses?: string[] // absent on records created before the field existed
}

export type Level = 'increased' | 'decreased' | 'normal'
export type UrineOption = 'anuria' | 'oliguria' | 'frequent' | 'nocturnal' | 'normal'

// Quick-pick generals; every field is optional and unset means "not asked".
export interface GeneralsChecklist {
  appetite?: Level
  thirst?: Level
  urine?: UrineOption[]
  sleep?: 'sound' | 'disturbed' | 'sleeplessness'
  stool?: 'regular' | 'irregular' | 'constipation'
  constipationDays?: number // only with stool = constipation
  sweat?: Level
  sweatParts?: string // only with sweat = increased
}

export type ComplaintStatusValue = 'persists' | 'better' | 'worse' | 'resolved'

export interface ComplaintStatus {
  complaint: string
  status: ComplaintStatusValue
}

export interface CaseNotes {
  complaint?: string // complaints joined with newlines; kept for print, certificates and reports
  complaints?: string[] // absent on records created before the list existed
  complaintStatus?: ComplaintStatus[] // progress of the previous visit's complaints
  generalsChecklist?: GeneralsChecklist
  history?: string
  mentals?: string
  generals?: string
  modalities?: string
  constitution?: string
}

export interface Visit extends BaseRecord {
  patientId: string
  date: string // ISO date
  caseNotes: CaseNotes
  advice?: string
  followUpDate?: string
}

export interface PrescriptionItem extends BaseRecord {
  visitId: string
  patientId: string
  remedyId: string
  potency: string
  dose?: string
  repetition?: string
  durationDays?: number
  order?: number // position in the prescription
  stockItemId?: string
  qtyDispensed?: number
}

export type AttachmentKind = 'lab' | 'photo' | 'other'

export interface Attachment extends BaseRecord {
  patientId: string
  visitId?: string
  kind: AttachmentKind
  mime: string
  fileName: string
  originalSize: number
  size: number
  blobHash: string
  caption?: string
  pages?: number // PDFs only, when known
}

// Content-addressed file store. Not a BaseRecord: blobs are immutable and
// uploaded once per hash.
export interface StoredBlob {
  hash: string
  blob: Blob
  synced: 0 | 1
}

export type AppointmentStatus = 'booked' | 'arrived' | 'done' | 'no-show' | 'cancelled'

export interface Appointment extends BaseRecord {
  patientId: string
  start: number // epoch ms
  end: number
  status: AppointmentStatus
  token?: number
  notes?: string
}

export interface BillItem {
  desc: string
  amount: number
  stockItemId?: string
  qty?: number
  // Counter sale: this bill itself takes `qty` out of stock (a 'dispense'
  // move with refId = bill id). Lines copied from a visit's dispensing leave
  // it unset, because the visit already moved the stock.
  sale?: true
}

export interface Bill extends BaseRecord {
  billNo: string
  patientId: string
  visitId?: string
  date: string
  items: BillItem[]
  discount: number
  total: number
  paid: number
  balance: number
  dueDate?: string
}

export type PaymentMode = 'cash' | 'upi' | 'card' | 'other'

export interface Payment extends BaseRecord {
  billId: string
  patientId: string
  amount: number
  mode: PaymentMode
  date: string
  receiptNo: string
}

export interface Remedy extends BaseRecord {
  name: string
  abbrev?: string
  isCustom: 0 | 1
}

export type StockForm = 'globules' | 'dilution' | 'tablet' | 'mother-tincture' | 'other'

export interface StockItem extends BaseRecord {
  remedyId: string
  potency: string
  form: StockForm
  qty: number
  unit: string
  lowStockAt: number
  price: number
}

export type StockMoveReason = 'purchase' | 'dispense' | 'adjust'

export interface StockMove extends BaseRecord {
  stockItemId: string
  delta: number
  reason: StockMoveReason
  date: string // ISO date the stock physically moved
  refId?: string // dispense moves: PrescriptionItem id (visit) or Bill id (counter sale)
  note?: string
}

// A consulting session within a day, as local "HH:MM" times.
export type CertificateKind = 'medicine' | 'medical'

// An issued certificate. The wording is stored as printed, so a reprint
// matches the original even after the templates change. Cancelling one is a
// soft delete: the number stays used.
export interface Certificate extends BaseRecord {
  certNo: string
  kind: CertificateKind
  patientId: string
  visitId?: string
  date: string // ISO date of issue
  place?: string
  title: string
  body: string
  condition?: string
  restFrom?: string // medical: ISO dates of advised rest
  restTo?: string
  medicines?: string[] // medicine: one line per medicine
}

// Images for printouts, as data URLs. Kept apart from ClinicSettings so the
// settings form never rewrites them, and so they can be cleared on their own.
export interface Branding {
  logo?: string
  header?: string // a whole letterhead header, for the 'image' style
  signature?: string
  seal?: string
}

// classic: logo and name left, address right. centered: logo above a
// full-width name. logoLeft: big serif name beside the logo, contacts with
// icons. image: the uploaded header image as is.
export type LetterheadStyle = 'classic' | 'centered' | 'logoLeft' | 'image'

export type CandidateLine = 'bottom' | 'top' | 'none'

// Per certificate type. 'default' follows the clinic-wide setting.
export interface CertTypeSettings {
  title: string
  template: string
  letterheadStyle: LetterheadStyle | 'default'
  watermark: 'default' | 'on' | 'off'
  candidateLine: CandidateLine
}

export interface ClinicSession {
  start: string
  end: string
}

// A reusable WhatsApp message (greeting, follow-up, festival wish) with {placeholders}.
export interface WhatsAppTemplate {
  id: string
  name: string
  body: string
}

export interface ClinicSettings {
  clinicName: string
  doctorName: string
  qualification: string
  regNo: string
  address: string
  phone: string
  email: string
  opPrefix: string
  whatsappDueTemplate: string
  // Absent on data saved before templates existed; getSettings fills the defaults.
  whatsappTemplates?: WhatsAppTemplate[]
  consultationFee: number
  defaultDueDays: number
  encryptDrive: boolean
  sessions: ClinicSession[]
  slotMinutes: number
  letterheadStyle: LetterheadStyle
  certPlace: string
  certWatermark: boolean
  certTypes: Record<CertificateKind, CertTypeSettings>
}

// Key/value store for settings, sequence counters and sync metadata.
export interface KV<T = unknown> {
  key: string
  value: T
  updatedAt: number
}

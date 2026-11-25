import { useEffect, useRef, useState } from 'react'
import { TabulatorFull as Tabulator } from 'tabulator-tables'
import type { CellComponent, ColumnDefinition, RowComponent } from 'tabulator-tables'
import 'tabulator-tables/dist/css/tabulator.min.css'
import './App.css'

type EmployeeRow = Record<string, unknown> & {
  __lfRowId: string
}

type RequestChangeSet = {
  type: 'employee-request:save'
  requests: Record<string, unknown>[]
}

type UserRole = 'HR' | 'Manager'
type RequestRow = EmployeeRow & {
  Request_Status: string
  Farm: string
  Preferred_Arrival_By: string
  Flight_Number: string
  Flight_Carrier: string
  Flight_Origin: string
  Flight_Destination: string
  Flight_Date: string
  Flight_Time: string
}

type TemporaryWorkerRow = {
  __lfRowId: string
  Employee_Number: string
  Farm: string
  FullName: string
  PhoneNumber: string
  Email: string
  Saved: boolean
}

type PageTab = 'employee-requests' | 'additional-workers'
type PendingOperation =
  | { kind: 'save'; employeeRows: RequestRow[]; workerRowIds: string[] }
  | { kind: 'remove-worker'; workerRowId: string }

const FLIGHT_FIELDS = [
  'Flight_Number',
  'Flight_Carrier',
  'Flight_Origin',
  'Flight_Destination',
  'Flight_Date',
  'Flight_Time',
] as const
const FLIGHT_DEFINITION_FIELDS = FLIGHT_FIELDS.filter((field) => field !== 'Flight_Number')
const AIRLINE_OPTIONS = [
  'Air Canada',
  'WestJet',
  'Porter Airlines',
  'Air Transat',
  'Flair Airlines',
  'Canadian North',
]
const MAX_WORKERS_PER_ADD = 1000
const LF_SANDBOX_ORIGIN = 'https://sandbox-forms.laserfiche.ca'

function flightSnapshot(row: EmployeeRow): string {
  return JSON.stringify(FLIGHT_FIELDS.map((field) => row[field] ?? ''))
}

const REQUEST_FIELDS = [
  'Employee_Number',
  'FullName',
  'Status',
  'Request_Status',
  'Farm',
  'Preferred_Arrival_By',
  ...FLIGHT_FIELDS,
] as const

function requestSnapshot(row: EmployeeRow): string {
  return JSON.stringify(REQUEST_FIELDS.map((field) => row[field] ?? ''))
}

function buildRequestRows(
  employees: Record<string, unknown>[],
  flights: Record<string, unknown>[] = [],
): RequestRow[] {
  const flightsByEmployee = new Map<string, Record<string, unknown>[]>()
  for (const flight of flights) {
    const employeeNumber = String(flight.Employee_Number ?? '')
    if (!employeeNumber) continue
    const matches = flightsByEmployee.get(employeeNumber) ?? []
    matches.push(flight)
    flightsByEmployee.set(employeeNumber, matches)
  }
  const flightByNumber = new Map(
    flights
      .filter((flight) => flight.Flight_Number)
      .map((flight) => [String(flight.Flight_Number), flight]),
  )

  return employees.map((employee, index) => {
    const employeeNumber = String(
      employee.Employee_Number ?? employee.EmployeeNumber ?? employee.employeeNumber ?? '',
    )
    const employeeFlights = flightsByEmployee.get(employeeNumber) ?? []
    const request = employeeFlights.find((flight) =>
      flight.Request_Status || flight.Farm || flight.Requested_Arrival,
    ) ?? {}
    const requestStatus = String(request.Request_Status ?? '')
    const activeFlight = employeeFlights.find((flight) =>
      [
        flight.Flight_Number,
        flight.Flight_Carrier,
        flight.Flight_Origin,
        flight.Flight_Destination,
        dateForGrid(flight.Flight_Date),
        timeForGrid(flight.Flight_Date),
        flight.Flight_Time,
      ].some((value) => String(value ?? '').trim()),
    ) ?? {}
    const flightNumber = String(activeFlight.Flight_Number ?? '')
    const flight = flightByNumber.get(flightNumber) ?? activeFlight
    const flightDate = flight.Flight_Date
    return {
      Employee_Number: employeeNumber,
      FullName: String(employee.FullName ?? employee.fullName ?? ''),
      Status: String(employee.Status ?? employee.status ?? ''),
      Request_Status: requestStatus,
      Farm: String(request.Farm ?? ''),
      Preferred_Arrival_By: dateForGrid(
        request.Requested_Arrival ?? request.Preferred_Arrival_By,
      ),
      Flight_Number: flightNumber,
      Flight_Carrier: String(flight.Flight_Carrier ?? ''),
      Flight_Origin: String(flight.Flight_Origin ?? ''),
      Flight_Destination: String(flight.Flight_Destination ?? ''),
      Flight_Date: dateForGrid(flightDate),
      Flight_Time: timeForGrid(flightDate) ||
        laserTimeToInput(String(flight.Flight_Time ?? '')),
      __lfRowId: `request-${index}`,
    }
  })
}

function toRequestPayload(row: RequestRow): Record<string, unknown> {
  return {
    Employee_Number: row.Employee_Number,
    FullName: row.FullName,
    Request_Status: row.Request_Status,
    Farm: row.Farm,
    Preferred_Arrival_By: dateTimeForLaser(row.Preferred_Arrival_By, ''),
    Flight_Number: row.Flight_Number,
    Flight_Carrier: row.Flight_Carrier,
    Flight_Origin: row.Flight_Origin,
    Flight_Destination: row.Flight_Destination,
    Flight_DateTime: dateTimeForLaser(row.Flight_Date, row.Flight_Time),
    PhoneNumber: row.PhoneNumber ?? '',
    Email: row.Email ?? '',
  }
}

function flightDefinition(row: EmployeeRow): Record<string, unknown> {
  return Object.fromEntries(
    FLIGHT_DEFINITION_FIELDS.map((field) => [field, row[field] ?? '']),
  )
}

function updateFlightAutocompleteOption(
  flightNumber: string,
  definition: Record<string, unknown>,
  options: Record<string, string>,
) {
  if (!flightNumber) return
  if (flightHasNotHappened(definition)) {
    options[flightNumber] = flightNumber
  } else {
    delete options[flightNumber]
  }
}

function refreshFlightAutocompleteOptions(
  definitions: Map<string, Record<string, unknown>>,
  options: Record<string, string>,
) {
  for (const flightNumber of Object.keys(options)) {
    delete options[flightNumber]
  }
  for (const [flightNumber, definition] of definitions) {
    updateFlightAutocompleteOption(flightNumber, definition, options)
  }
}

function updateFlightDefinition(
  flightNumber: string,
  row: EmployeeRow,
  definitions: Map<string, Record<string, unknown>>,
  options: Record<string, string>,
) {
  if (!flightNumber) return
  const definition = {
    Flight_Number: flightNumber,
    ...flightDefinition(row),
  }
  definitions.set(flightNumber, definition)
  updateFlightAutocompleteOption(flightNumber, definition, options)
}

function laserTimeToInput(value: string): string {
  const match = value.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i)
  if (!match) return value.slice(0, 5)
  let hours = Number(match[1]) % 12
  if (match[3].toUpperCase() === 'PM') hours += 12
  return `${String(hours).padStart(2, '0')}:${match[2]}`
}

function inputTimeToLaser(value: string): string {
  const [rawHours, minutes] = value.split(':')
  if (rawHours === undefined || minutes === undefined) return ''
  const hours = Number(rawHours)
  const suffix = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours % 12 || 12
  return `${String(displayHours).padStart(2, '0')}:${minutes}:00 ${suffix}`
}

function dateForGrid(value: unknown): string {
  if (value && typeof value === 'object' && 'dateStr' in value) {
    return String(value.dateStr ?? '')
  }
  return typeof value === 'string' ? value.split('T')[0] : ''
}

function timeForGrid(value: unknown): string {
  if (value && typeof value === 'object' && 'timeStr' in value) {
    return laserTimeToInput(String(value.timeStr ?? ''))
  }
  if (typeof value === 'string' && value.includes('T')) {
    return value.split('T')[1].slice(0, 5)
  }
  return ''
}

function flightHasNotHappened(flight: Record<string, unknown>, now = new Date()): boolean {
  const dateMatch = dateForGrid(flight.Flight_Date).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!dateMatch) return false

  const [, rawYear, rawMonth, rawDay] = dateMatch
  const year = Number(rawYear)
  const month = Number(rawMonth)
  const day = Number(rawDay)
  const parsedDate = new Date(year, month - 1, day)
  if (
    parsedDate.getFullYear() !== year ||
    parsedDate.getMonth() !== month - 1 ||
    parsedDate.getDate() !== day
  ) {
    return false
  }

  const flightDay = Date.UTC(year, month - 1, day)
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  if (flightDay !== today) return flightDay > today

  const flightTime = timeForGrid(flight.Flight_Date) ||
    laserTimeToInput(String(flight.Flight_Time ?? ''))
  const timeMatch = flightTime.match(/^(\d{2}):(\d{2})$/)
  if (!timeMatch) return false

  const flightHour = Number(timeMatch[1])
  const flightMinute = Number(timeMatch[2])
  if (flightHour > 23 || flightMinute > 59) return false
  const flightMinutes = flightHour * 60 + flightMinute
  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  return flightMinutes > currentMinutes
}

function dateTimeForLaser(date: unknown, time: unknown): Record<string, string> | '' {
  const dateValue = date && typeof date === 'object' && 'dateStr' in date
    ? date.dateStr
    : date
  const timeValue = String(
    date && typeof date === 'object' && 'timeStr' in date
      ? date.timeStr ?? time ?? ''
      : time ?? '',
  )
  const dateStr = String(dateValue ?? '')
  if (!dateStr) return ''
  return {
    dateStr,
    ...(timeValue ? { timeStr: inputTimeToLaser(timeValue) } : {}),
  }
}

function flightNumberEditor(
  cell: CellComponent,
  onRendered: (callback: () => void) => void,
  success: (value: unknown) => boolean,
  cancel: (value: unknown) => void,
  options: Record<string, string>,
  definitions: Map<string, Record<string, unknown>>,
): HTMLInputElement {
  const input = document.createElement('input')
  const datalist = document.createElement('datalist')
  const listId = `flight-options-${crypto.randomUUID()}`
  let completed = false

  refreshFlightAutocompleteOptions(definitions, options)
  datalist.id = listId
  for (const [value, label] of Object.entries(options)) {
    const option = document.createElement('option')
    option.value = value
    option.label = label
    datalist.append(option)
  }
  document.body.append(datalist)

  input.type = 'text'
  input.value = String(cell.getValue() ?? '')
  input.setAttribute('list', listId)
  input.style.width = '100%'
  input.style.height = '100%'
  input.style.boxSizing = 'border-box'

  const cleanup = () => datalist.remove()
  const commit = () => {
    if (completed) return
    success(input.value)
    completed = true
    cleanup()
  }
  const cancelEdit = () => {
    if (completed) return
    completed = true
    cleanup()
    cancel(undefined)
  }

  input.addEventListener('change', commit)
  input.addEventListener('blur', commit)
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') commit()
    if (event.key === 'Escape') cancelEdit()
  })
  onRendered(() => input.focus())
  return input
}

const REQUEST_STATUS_TRANSITIONS: Record<UserRole, Record<string, string[]>> = {
  Manager: {
    '': ['Requested'],
    Requested: [''],
    Arrived: ['Request Return'],
    'Request Return': ['Arrived'],
  },
  HR: {
    Requested: ['Flight Booked'],
    'Flight Booked': ['Requested', 'Arrived', 'Flight Missed', 'Request Return'],
    'Flight Missed': ['Flight Booked'],
    'Request Return': ['Flight Booked'],
  },
}
const BOOKED_REQUEST_STATUSES = new Set(['Flight Booked', 'Return Flight Booked'])
const EMPTY_REQUEST_STATUS_FILTER = '__empty_request_status__'
const EMPTY_FARM_FILTER = '__empty_farm__'

function allowedRequestStatusTransitions(role: UserRole | null, status: string): string[] {
  return role ? REQUEST_STATUS_TRANSITIONS[role][status] ?? [] : []
}

function isCellEditable(
  role: UserRole | null,
  rowData: EmployeeRow,
  field: string,
  columnEditable: boolean,
): boolean {
  if (!columnEditable) return false
  const requestStatus = String(rowData.Request_Status ?? '').trim()
  const isBooked = BOOKED_REQUEST_STATUSES.has(requestStatus)
  if (field === 'Request_Status') {
    return allowedRequestStatusTransitions(role, requestStatus).length > 0
  }
  if (role === 'HR' && field === 'Flight_Number') {
    return isBooked
  }
  if (
    role === 'HR' &&
    (FLIGHT_DEFINITION_FIELDS as readonly string[]).includes(field)
  ) {
    return isBooked
  }
  if (role !== 'Manager') return false
  if (requestStatus === 'Arrived') return false
  if (field === 'Farm') return Boolean(requestStatus)
  if (field === 'Preferred_Arrival_By') {
    return Boolean(requestStatus) && !isBooked
  }
  return false
}

function updateEditableCellStyles(
  row: RowComponent,
  role: UserRole | null,
  saving = false,
) {
  const rowData = row.getData() as EmployeeRow
  for (const cell of row.getCells()) {
    const columnEditable = cell.getColumn().getDefinition().editable !== false
    cell.getElement().classList.toggle(
      'is-editable',
      !saving && isCellEditable(role, rowData, String(cell.getField()), columnEditable),
    )
  }
}

function headerSelectFilter(options: { label: string; value: string }[]) {
  return (
    cell: CellComponent,
    _onRendered: (callback: () => void) => void,
    success: (value: unknown) => boolean,
  ): HTMLSelectElement => {
    const select = document.createElement('select')
    const allOption = document.createElement('option')
    allOption.value = ''
    allOption.textContent = 'All'
    select.append(allOption)

    for (const { label, value } of options) {
      const option = document.createElement('option')
      option.value = value
      option.textContent = label
      select.append(option)
    }

    select.value = String(cell.getValue() ?? '')
    select.style.width = '100%'
    select.addEventListener('change', () => success(select.value))
    return select
  }
}

function requestStatusEditor(
  cell: CellComponent,
  onRendered: (callback: () => void) => void,
  success: (value: unknown) => boolean,
  cancel: (value: unknown) => void,
  role: UserRole,
): HTMLSelectElement {
  const currentStatus = String(cell.getValue() ?? '')
  const select = document.createElement('select')
  const values = [
    currentStatus,
    ...allowedRequestStatusTransitions(role, currentStatus),
  ]
  let completed = false

  for (const value of new Set(values)) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = value || 'Blank'
    select.append(option)
  }

  select.value = currentStatus
  select.style.width = '100%'
  select.style.height = '100%'
  select.style.boxSizing = 'border-box'

  const commit = () => {
    if (completed) return
    success(select.value)
    completed = true
  }
  const cancelEdit = () => {
    if (completed) return
    completed = true
    cancel(undefined)
  }

  select.addEventListener('change', commit)
  select.addEventListener('blur', commit)
  select.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') commit()
    if (event.key === 'Escape') cancelEdit()
  })
  onRendered(() => select.focus())
  return select
}

function airlineEditor(
  cell: CellComponent,
  onRendered: (callback: () => void) => void,
  success: (value: unknown) => boolean,
  cancel: (value: unknown) => void,
): HTMLSelectElement {
  const currentAirline = String(cell.getValue() ?? '')
  const select = document.createElement('select')
  const placeholder = document.createElement('option')
  let completed = false

  placeholder.value = ''
  placeholder.textContent = 'Select an airline'
  select.append(placeholder)

  if (currentAirline && !AIRLINE_OPTIONS.includes(currentAirline)) {
    const existingOption = document.createElement('option')
    existingOption.value = currentAirline
    existingOption.textContent = `${currentAirline} (existing)`
    select.append(existingOption)
  }

  for (const airline of AIRLINE_OPTIONS) {
    const option = document.createElement('option')
    option.value = airline
    option.textContent = airline
    select.append(option)
  }

  select.value = currentAirline
  select.style.width = '100%'
  select.style.height = '100%'
  select.style.boxSizing = 'border-box'

  const commit = () => {
    if (completed) return
    success(select.value)
    completed = true
  }
  const cancelEdit = () => {
    if (completed) return
    completed = true
    cancel(undefined)
  }

  select.addEventListener('change', commit)
  select.addEventListener('blur', commit)
  select.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') commit()
    if (event.key === 'Escape') cancelEdit()
  })
  onRendered(() => select.focus())
  return select
}

function requestColumns(
  worksites: string[],
  flightOptions: Record<string, string>,
  role: UserRole,
  flightDefinitions: Map<string, Record<string, unknown>>,
): ColumnDefinition[] {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const minDate = [
    tomorrow.getFullYear(),
    String(tomorrow.getMonth() + 1).padStart(2, '0'),
    String(tomorrow.getDate()).padStart(2, '0'),
  ].join('-')

  return [
    { title: 'Employee number', field: 'Employee_Number', minWidth: 112, widthGrow: 1.1, editable: false },
    { title: 'Full name', field: 'FullName', minWidth: 150, widthGrow: 1.5, editable: false },
    {
      title: 'Current status',
      field: 'Status',
      minWidth: 100,
      widthGrow: 0.9,
      editable: false,
      headerFilter: headerSelectFilter([
        { label: 'Active', value: 'Active' },
        { label: 'Terminated', value: 'Terminated' },
      ]),
    },
    {
      title: 'Request status',
      field: 'Request_Status',
      minWidth: 135,
      widthGrow: 1.1,
      editor: (cell, onRendered, success, cancel) =>
        requestStatusEditor(cell, onRendered, success, cancel, role),
      headerFilter: headerSelectFilter([
        { label: 'Blank', value: EMPTY_REQUEST_STATUS_FILTER },
        { label: 'Requested', value: 'Requested' },
        { label: 'Arrived', value: 'Arrived' },
        { label: 'Request Return', value: 'Request Return' },
        { label: 'Flight Booked', value: 'Flight Booked' },
        { label: 'Flight Missed', value: 'Flight Missed' },
        { label: 'Return Flight Booked', value: 'Return Flight Booked' },
      ]),
      headerFilterFunc: (filterValue, rowValue) =>
        filterValue === EMPTY_REQUEST_STATUS_FILTER
          ? !String(rowValue ?? '').trim()
          : String(rowValue ?? '').trim() === filterValue,
    },
    {
      title: 'Farm',
      field: 'Farm',
      minWidth: 130,
      widthGrow: 1.1,
      editor: 'list',
      editorParams: { values: ['', ...worksites] },
      headerFilter: headerSelectFilter([
        { label: 'Blank', value: EMPTY_FARM_FILTER },
        ...worksites.map((worksite) => ({ label: worksite, value: worksite })),
      ]),
      headerFilterFunc: (filterValue, rowValue) =>
        filterValue === EMPTY_FARM_FILTER
          ? !String(rowValue ?? '').trim()
          : String(rowValue ?? '').trim() === filterValue,
    },
    {
      title: 'Req. Arrival/Departure',
      field: 'Preferred_Arrival_By',
      minWidth: 155,
      widthGrow: 1.2,
      editor: 'date',
      editorParams: { min: minDate },
      headerFilter: 'date',
      headerFilterPlaceholder: 'Filter by date',
    },
    {
      title: 'Flight number',
      field: 'Flight_Number',
      minWidth: 120,
      widthGrow: 1.1,
      editor: (cell, onRendered, success, cancel) =>
        flightNumberEditor(cell, onRendered, success, cancel, flightOptions, flightDefinitions),
    },
    {
      title: 'Airline',
      field: 'Flight_Carrier',
      minWidth: 120,
      widthGrow: 1.3,
      editor: airlineEditor,
    },
    { title: 'Origin', field: 'Flight_Origin', minWidth: 90, widthGrow: 0.8 },
    { title: 'Destination', field: 'Flight_Destination', minWidth: 110, widthGrow: 1.0 },
    {
      title: 'Flight date',
      field: 'Flight_Date',
      minWidth: 120,
      widthGrow: 1.0,
      editor: 'date',
      headerFilter: 'date',
      headerFilterPlaceholder: 'Filter by date',
    },
    { title: 'Flight time', field: 'Flight_Time', minWidth: 82, widthGrow: 0.8, editor: 'time' },
  ]
}

function App() {
  const tableElement = useRef<HTMLDivElement>(null)
  const table = useRef<Tabulator | null>(null)
  const formWindow = useRef<Window | null>(null)
  const nextTemporaryEmployeeNumber = useRef(-1)
  const savingRef = useRef(false)
  const pendingOperation = useRef<PendingOperation | null>(null)
  const previewMode = useRef(false)
  const pendingChangeCountRef = useRef(0)
  const hasUnsubmittedFormChangesRef = useRef(false)
  const role = useRef<UserRole | null>(null)
  const flightDefinitions = useRef(new Map<string, Record<string, unknown>>())
  const flightOptions = useRef<Record<string, string>>({})
  const originalRows = useRef(new Map<string, string>())
  const originalFlightRows = useRef(new Map<string, string>())
  const updatedRows = useRef(new Map<string, EmployeeRow>())
  const [columns, setColumns] = useState<ColumnDefinition[]>([])
  const [rows, setRows] = useState<EmployeeRow[]>([])
  const [worksites, setWorksites] = useState<string[]>([])
  const [previewModeActive, setPreviewModeActive] = useState(false)
  const [activeTab, setActiveTab] = useState<PageTab>('employee-requests')
  const [temporaryWorkers, setTemporaryWorkers] = useState<TemporaryWorkerRow[]>([])
  const [workerFarm, setWorkerFarm] = useState('')
  const [workerCount, setWorkerCount] = useState('1')
  const [workerError, setWorkerError] = useState('')
  const [ready, setReady] = useState(false)
  const [message, setMessage] = useState('Waiting for employee data from Laserfiche')
  const [changeCount, setChangeCount] = useState(0)
  const [rowCount, setRowCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveNotice, setSaveNotice] = useState('')
  const [hasUnsubmittedFormChanges, setHasUnsubmittedFormChanges] = useState(false)

  function setSavingState(value: boolean) {
    savingRef.current = value
    setSaving(value)
    table.current?.redraw(true)
  }

  function setFormChangesAwaitingSubmission(value: boolean) {
    hasUnsubmittedFormChangesRef.current = value
    setHasUnsubmittedFormChanges(value)
  }

  function trackUpdate(row: EmployeeRow) {
    const original = originalRows.current.get(row.__lfRowId)
    const snapshot = requestSnapshot(row)
    if (original !== undefined && original === snapshot) {
      updatedRows.current.delete(row.__lfRowId)
    } else {
      updatedRows.current.set(row.__lfRowId, row)
    }
    setSaveNotice('')
    setChangeCount(updatedRows.current.size)
  }

  function matchingFlightRows(flightNumber: string, exceptRowId?: string): RowComponent[] {
    const grid = table.current
    if (!grid || !flightNumber) return []

    return grid.getData()
      .filter((data) =>
        String(data.Flight_Number ?? '') === flightNumber && data.__lfRowId !== exceptRowId,
      )
      .map((data) => grid.getRow(data.__lfRowId))
      .filter((row): row is RowComponent => Boolean(row))
  }

  function clearFlightDefinition(row: RowComponent) {
    row.update({
      Flight_Carrier: '',
      Flight_Origin: '',
      Flight_Destination: '',
      Flight_Date: '',
      Flight_Time: '',
    })
  }

  function clearFlightAssignment(row: RowComponent) {
    row.update({
      Flight_Number: '',
      Flight_Carrier: '',
      Flight_Origin: '',
      Flight_Destination: '',
      Flight_Date: '',
      Flight_Time: '',
    })
  }

  function fillFlightDefinition(row: RowComponent, definition: Record<string, unknown>) {
    row.update({
      Flight_Carrier: definition.Flight_Carrier ?? '',
      Flight_Origin: definition.Flight_Origin ?? '',
      Flight_Destination: definition.Flight_Destination ?? '',
      Flight_Date: dateForGrid(definition.Flight_Date),
      Flight_Time: timeForGrid(definition.Flight_Date) ||
        laserTimeToInput(String(definition.Flight_Time ?? '')),
    })
  }

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data
      if (event.origin !== LF_SANDBOX_ORIGIN) return

      if (data?.type === 'employee-tabulator:submission-check') {
        if (event.source !== formWindow.current) return
        const canSubmit = pendingChangeCountRef.current === 0 && !savingRef.current
        if (canSubmit) setFormChangesAwaitingSubmission(false)
        ;(event.source as Window).postMessage(
          canSubmit
            ? { type: 'employee-tabulator:submission-ready' }
            : {
                type: 'employee-tabulator:submission-blocked',
                message: 'Save or remove the pending employee request changes before submitting the form.',
              },
          LF_SANDBOX_ORIGIN,
        )
        return
      }

      if (data?.type === 'employee-request:saved') {
        if (event.source !== formWindow.current) return
        const operation = pendingOperation.current
        if (operation?.kind !== 'save') return
        setSavingState(false)
        for (const row of operation.employeeRows) {
          originalRows.current.set(row.__lfRowId, requestSnapshot(row))
          originalFlightRows.current.set(row.__lfRowId, flightSnapshot(row))
        }
        const savedWorkerIds = new Set(operation.workerRowIds)
        setTemporaryWorkers((current) =>
          current.map((worker) =>
            savedWorkerIds.has(worker.__lfRowId) ? { ...worker, Saved: true } : worker,
          ),
        )
        pendingOperation.current = null
        setChangeCount(updatedRows.current.size)
        setFormChangesAwaitingSubmission(true)
        setSaveNotice('Saved to the Laserfiche form, not submitted. Submit the form to finalize these changes.')
        return
      }

      if (data?.type === 'employee-request:workers-removed') {
        if (event.source !== formWindow.current) return
        const operation = pendingOperation.current
        if (operation?.kind !== 'remove-worker') return
        setSavingState(false)
        setTemporaryWorkers((current) =>
          current.filter((worker) => worker.__lfRowId !== operation.workerRowId),
        )
        pendingOperation.current = null
        setFormChangesAwaitingSubmission(true)
        setSaveNotice('Saved worker request removed from the form. Submit the form to finalize your changes.')
        return
      }

      if (data?.type === 'employee-request:save-error') {
        if (event.source !== formWindow.current) return
        const operation = pendingOperation.current
        if (operation?.kind === 'save') {
          for (const row of operation.employeeRows) {
            updatedRows.current.set(row.__lfRowId, row)
          }
          setChangeCount(updatedRows.current.size)
        }
        pendingOperation.current = null
        setSavingState(false)
        setSaveNotice(`The form could not save employee travel rows: ${String(data.message ?? 'Unknown error')}`)
        return
      }

      if (data?.type === 'employee-tabulator:hello') {
        if (event.source) {
          formWindow.current = event.source as Window
          console.log('Replying ready to hello sender', event.origin)
          ;(event.source as Window).postMessage(
            { type: 'employee-tabulator:ready' },
            LF_SANDBOX_ORIGIN,
          )
        }
        return
      }

      if (!formWindow.current || event.source !== formWindow.current) return
      if (!data || typeof data !== 'object' || data.type !== 'employee-tabulator:init') return

      const payload = data as {
        data?: {
          employees?: unknown
          flights?: unknown
          worksites?: unknown
          Role?: unknown
        }
      }
      const employeeRows = payload.data?.employees
      const receivedRole = payload.data?.Role
      if (receivedRole !== 'HR' && receivedRole !== 'Manager') {
        role.current = null
        setReady(false)
        setRowCount(0)
        setMessage('Employee data must include Role "HR" or "Manager".')
        return
      }
      const worksiteValues = payload.data?.worksites
      const flightRows = payload.data?.flights
      if (!Array.isArray(employeeRows) || !Array.isArray(worksiteValues) ||
        !Array.isArray(flightRows)) {
        setReady(false)
        setRowCount(0)
        setMessage('Employee data must include employees, worksites, and flights.')
        return
      }

      role.current = receivedRole
      previewMode.current = false
      setPreviewModeActive(false)
      const worksites = [...new Set(worksiteValues.map((worksite) => {
        if (typeof worksite === 'string') return worksite
        if (!worksite || typeof worksite !== 'object') return ''
        const entry = worksite as Record<string, unknown>
        return String(entry.Worksite ?? entry.Farm ?? entry.Name ?? entry.data ?? '')
      }).filter(Boolean))]
      setWorksites(worksites)
      const normalizedRows = buildRequestRows(employeeRows, flightRows)
      const definitions = new Map<string, Record<string, unknown>>()
      for (const flight of flightRows) {
        const flightNumber = String(flight.Flight_Number ?? '')
        if (flightNumber && !definitions.has(flightNumber)) {
          definitions.set(flightNumber, flight)
        }
      }

      flightDefinitions.current = definitions
      refreshFlightAutocompleteOptions(definitions, flightOptions.current)

      originalRows.current = new Map(
        normalizedRows.map((row) => [row.__lfRowId, requestSnapshot(row)]),
      )
      originalFlightRows.current = new Map(
        normalizedRows.map((row) => [row.__lfRowId, flightSnapshot(row)]),
      )
      updatedRows.current.clear()
      setChangeCount(0)
      setColumns(requestColumns(
        worksites,
        flightOptions.current,
        receivedRole,
        flightDefinitions.current,
      ))
      setRows(normalizedRows)
      setRowCount(normalizedRows.length)
      setReady(true)
      setMessage('')
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  useEffect(() => {
    if (!ready || activeTab !== 'employee-requests' || !tableElement.current) return

    const editableColumns = columns.map((column) => ({
      ...column,
      editor: column.editor ?? 'input',
      editable: (cell: { getRow: () => RowComponent; getField: () => string }) => {
        if (savingRef.current) return false
        return isCellEditable(
          role.current,
          cell.getRow().getData() as EmployeeRow,
          cell.getField(),
          column.editable !== false,
        )
      },
      headerFilter: column.headerFilter ?? 'input',
    }))

    const grid = new Tabulator(tableElement.current, {
      data: rows,
      index: '__lfRowId',
      columns: editableColumns,
      layout: 'fitColumns',
      height: '100%',
      placeholder: 'No employee records',
      movableColumns: true,
      resizableColumnFit: true,
      reactiveData: false,
      columnDefaults: { vertAlign: 'middle', tooltip: true },
      rowFormatter: (row) =>
        updateEditableCellStyles(row, role.current, savingRef.current),
    })

    grid.on('cellEdited', (cell: CellComponent) => {
      const row = cell.getRow()
      const field = String(cell.getField())
      if (field === 'Flight_Number') {
        const flightNumber = String(cell.getValue() ?? '')
        const definition = flightDefinitions.current.get(flightNumber)
        const affectedRows = [row]
        if (!flightNumber) {
          for (const target of affectedRows) clearFlightDefinition(target)
        } else if (definition) {
          for (const target of affectedRows) fillFlightDefinition(target, definition)
          updateFlightAutocompleteOption(flightNumber, definition, flightOptions.current)
        } else {
          for (const target of affectedRows) clearFlightDefinition(target)
          updateFlightDefinition(
            flightNumber,
            row.getData() as EmployeeRow,
            flightDefinitions.current,
            flightOptions.current,
          )
        }
        for (const target of affectedRows) trackUpdate(target.getData() as EmployeeRow)
        return
      }

      if (
        field === 'Request_Status' &&
        role.current === 'HR' &&
        String(row.getData().Request_Status ?? '').trim() === 'Requested'
      ) {
        clearFlightAssignment(row)
      }

      const rowData = row.getData() as EmployeeRow
      const flightNumber = String(rowData.Flight_Number ?? '')
      if (flightNumber && (FLIGHT_DEFINITION_FIELDS as readonly string[]).includes(field)) {
        const updates = { [field]: rowData[field] }
        for (const target of matchingFlightRows(flightNumber, rowData.__lfRowId)) {
          target.update(updates)
          trackUpdate(target.getData() as EmployeeRow)
        }
        updateFlightDefinition(
          flightNumber,
          rowData,
          flightDefinitions.current,
          flightOptions.current,
        )
      }
      trackUpdate(rowData)
    })
    grid.on('cellEdited', (cell: CellComponent) => {
      updateEditableCellStyles(cell.getRow(), role.current)
    })
    grid.on('rowAdded', () => setRowCount(grid.getDataCount()))
    grid.on('rowDeleted', () => setRowCount(grid.getDataCount()))
    table.current = grid
    return () => {
      grid.destroy()
      table.current = null
    }
  }, [activeTab, columns, ready, rows])

  function saveChanges() {
    if (savingRef.current) return

    const changedRows = [...updatedRows.current.values()].filter((row) => {
      const original = originalRows.current.get(row.__lfRowId)
      return original === undefined || original !== requestSnapshot(row)
    })
    for (const rowId of updatedRows.current.keys()) {
      if (!changedRows.some((row) => row.__lfRowId === rowId)) {
        updatedRows.current.delete(rowId)
      }
    }
    setChangeCount(changedRows.length)

    const invalidRows = changedRows.filter((row) => {
      const flightChanged = originalFlightRows.current.get(row.__lfRowId) !== flightSnapshot(row)
      const flightIsBlank = FLIGHT_FIELDS.every(
        (field) => row[field] == null || row[field] === '',
      )
      const isBooked = BOOKED_REQUEST_STATUSES.has(String(row.Request_Status ?? ''))
      return !row.Employee_Number ||
        (isBooked && !row.Flight_Number) ||
        (flightChanged && !flightIsBlank &&
          !row.Flight_Number)
    })
    if (invalidRows.length) {
      setSaveNotice('Choose an existing flight number or enter a flight number and type before saving.')
      return
    }

    const unsavedWorkers = temporaryWorkers.filter((worker) => !worker.Saved)
    const workerRowIds = unsavedWorkers.map((worker) => worker.__lfRowId)
    const payload: RequestChangeSet = {
      type: 'employee-request:save',
      requests: [
        ...(changedRows as RequestRow[]).map(toRequestPayload),
        ...unsavedWorkers.map((worker) => ({
          Employee_Number: worker.Employee_Number,
          FullName: worker.FullName,
          Request_Status: 'Requested',
          Farm: worker.Farm,
          Preferred_Arrival_By: '',
          Flight_Number: '',
          Flight_Carrier: '',
          Flight_Origin: '',
          Flight_Destination: '',
          Flight_DateTime: '',
          PhoneNumber: worker.PhoneNumber,
          Email: worker.Email,
        })),
      ],
    }
    if (payload.requests.length === 0) return

    if (previewMode.current) {
      for (const row of changedRows) {
        originalRows.current.set(row.__lfRowId, requestSnapshot(row))
        originalFlightRows.current.set(row.__lfRowId, flightSnapshot(row))
      }
      updatedRows.current.clear()
      setTemporaryWorkers((current) =>
        current.map((worker) =>
          workerRowIds.includes(worker.__lfRowId) ? { ...worker, Saved: true } : worker,
        ),
      )
      setChangeCount(0)
      setSaveNotice(`${changedRows.length} employee change(s) and ${unsavedWorkers.length} new worker request(s) saved in preview.`)
      return
    }
    if (!formWindow.current) {
      setSaveNotice('The Laserfiche form connection is not ready. Reload the form and try again.')
      return
    }

    pendingOperation.current = {
      kind: 'save',
      employeeRows: changedRows as RequestRow[],
      workerRowIds,
    }
    updatedRows.current.clear()
    setChangeCount(0)
    setSaveNotice('Saving employee and new worker requests...')
    setSavingState(true)
    formWindow.current.postMessage(payload, LF_SANDBOX_ORIGIN)
  }

  function addTemporaryWorkers() {
    const count = Number(workerCount)
    if (!workerFarm) {
      setWorkerError('Select a farm before adding workers.')
      return
    }
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_WORKERS_PER_ADD) {
      setWorkerError(`Enter a whole number between 1 and ${MAX_WORKERS_PER_ADD}.`)
      return
    }

    const newWorkers = Array.from({ length: count }, () => {
      const employeeNumber = String(nextTemporaryEmployeeNumber.current)
      nextTemporaryEmployeeNumber.current -= 1
      return {
        __lfRowId: `temporary-worker-${employeeNumber}`,
        Employee_Number: employeeNumber,
        Farm: workerFarm,
        FullName: '',
        PhoneNumber: '',
        Email: '',
        Saved: false,
      }
    })
    setTemporaryWorkers((current) => [...current, ...newWorkers])
    setWorkerFarm('')
    setWorkerError('')
    setSaveNotice('')
  }

  function updateTemporaryWorker(
    rowId: string,
    field: 'FullName' | 'PhoneNumber' | 'Email',
    value: string,
  ) {
    setTemporaryWorkers((current) =>
      current.map((worker) =>
        worker.__lfRowId === rowId ? { ...worker, [field]: value } : worker,
      ),
    )
    setSaveNotice('')
  }

  function removeTemporaryWorker(rowId: string) {
    if (savingRef.current) return
    const worker = temporaryWorkers.find((entry) => entry.__lfRowId === rowId)
    if (!worker) return

    if (!worker.Saved || previewMode.current) {
      setTemporaryWorkers((current) =>
        current.filter((entry) => entry.__lfRowId !== rowId),
      )
      setSaveNotice('')
      return
    }

    if (!formWindow.current) {
      setSaveNotice('The Laserfiche form connection is not ready. Reload the form and try again.')
      return
    }

    pendingOperation.current = { kind: 'remove-worker', workerRowId: rowId }
    setSaveNotice('Removing saved worker request...')
    setSavingState(true)
    formWindow.current.postMessage(
      {
        type: 'employee-request:remove-temporary-workers',
        employeeNumbers: [worker.Employee_Number],
      },
      LF_SANDBOX_ORIGIN,
    )
  }

  function loadSample() {
    const employees = Array.from({ length: 3000 }, (_, index) => ({
      Employee_Number: `LF-${String(index + 1).padStart(4, '0')}`,
      FullName: ['Morgan Chen', 'Avery Patel', 'Jordan Rivera', 'Riley Wilson'][index % 4],
      Status: ['Active', 'Terminated', 'Active', 'Active'][index % 4],
    }))
    previewMode.current = true
    setPreviewModeActive(true)
    role.current = 'HR'
    const worksites = ['Cedar Creek', 'Pine Ridge', 'Maple Grove', 'Willow Creek']
    setWorksites(worksites)
    const flights = employees.map((employee, index) => {
      const status = [
        '',
        'Requested',
        'Arrived',
        'Request Return',
        'Flight Booked',
        'Flight Missed',
      ][index % 6]
      const hasFlight = BOOKED_REQUEST_STATUSES.has(status)
      const day = String((index % 27) + 1).padStart(2, '0')
      const flightDay = String(20 + (index % 8)).padStart(2, '0')
      return {
        Employee_Number: employee.Employee_Number,
        Request_Status: status,
        Farm: status ? worksites[index % worksites.length] : '',
        Requested_Arrival: status ? { dateStr: `2026-12-${day}` } : '',
        Flight_Number: hasFlight
          ? `LF${420 + (index % 8)}`
          : '',
        Flight_Carrier: hasFlight ? 'Air Canada' : '',
        Flight_Origin: hasFlight ? 'YVR' : '',
        Flight_Destination: hasFlight ? 'YYZ' : '',
        Flight_Date: hasFlight
          ? { dateStr: `2026-12-${flightDay}`, timeStr: '08:30:00 AM' }
          : '',
      }
    })
    const sampleRows = buildRequestRows(employees, flights)
    flightDefinitions.current = new Map(
      flights.filter((flight) => flight.Flight_Number).map((flight) => [
        String(flight.Flight_Number),
        flight,
      ]),
    )
    refreshFlightAutocompleteOptions(flightDefinitions.current, flightOptions.current)
    originalRows.current = new Map(
      sampleRows.map((row) => [row.__lfRowId, requestSnapshot(row)]),
    )
    originalFlightRows.current = new Map(
      sampleRows.map((row) => [row.__lfRowId, flightSnapshot(row)]),
    )
    updatedRows.current.clear()
    setChangeCount(0)
    setColumns(requestColumns(
      worksites,
      flightOptions.current,
      'HR',
      flightDefinitions.current,
    ))
    setRows(sampleRows)
    setRowCount(sampleRows.length)
    setReady(true)
    setMessage('')
  }

  const unsavedWorkerCount = temporaryWorkers.filter((worker) => !worker.Saved).length
  const pendingChangeCount = changeCount + unsavedWorkerCount
  const shouldWarnBeforeUnload = ready && !previewModeActive &&
    (pendingChangeCount > 0 || saving || hasUnsubmittedFormChanges)

  useEffect(() => {
    pendingChangeCountRef.current = pendingChangeCount
  }, [pendingChangeCount])

  useEffect(() => {
    if (!shouldWarnBeforeUnload) return

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (previewModeActive ||
        (pendingChangeCountRef.current === 0 &&
          !savingRef.current &&
          !hasUnsubmittedFormChangesRef.current)) {
        return
      }
      event.preventDefault()
      event.returnValue = ' '
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [previewModeActive, shouldWarnBeforeUnload])

  return (
    <main className="workspace">
      <section className="page-heading">
        <div>
          <p className="eyebrow">PEOPLE OPERATIONS <span>/</span> EMPLOYEE REQUESTS</p>
          <h1>Employee Hiring and Flight Requests</h1>
          <p className="subheading">Track employee hiring and return requests, worksites, and flight details.</p>
        </div>
        <div className="record-total"><strong>{activeTab === 'employee-requests' ? rowCount.toLocaleString() : temporaryWorkers.length.toLocaleString()}</strong><span>{activeTab === 'employee-requests' ? 'records' : 'requested workers'}</span></div>
      </section>

      <nav className="page-tabs" role="tablist" aria-label="Request type">
        <button
          id="employee-requests-tab"
          className={`page-tab${activeTab === 'employee-requests' ? ' is-active' : ''}`}
          type="button"
          role="tab"
          aria-selected={activeTab === 'employee-requests'}
          aria-controls="employee-requests-panel"
          onClick={() => setActiveTab('employee-requests')}
        >
          Employee requests
        </button>
        <button
          id="additional-workers-tab"
          className={`page-tab${activeTab === 'additional-workers' ? ' is-active' : ''}`}
          type="button"
          role="tab"
          aria-selected={activeTab === 'additional-workers'}
          aria-controls="additional-workers-panel"
          onClick={() => setActiveTab('additional-workers')}
        >
          Additional workers
        </button>
      </nav>

      <section
        className="table-section"
        aria-label={activeTab === 'employee-requests' ? 'Employee records' : 'Additional worker requests'}
      >
        {activeTab === 'employee-requests' ? (
          <div id="employee-requests-panel" role="tabpanel" aria-labelledby="employee-requests-tab">
        <div className="table-toolbar">
          <div className="table-title"><span className="section-index">01</span><h2>Employee hiring and flight requests</h2><span className="count-chip">{rowCount.toLocaleString()}</span></div>
        </div>
        {!ready ? (
          <div className="empty-state">
            <div className="empty-mark" aria-hidden="true">↘</div>
            <strong>{message}</strong>
            <span>Waiting for employee, worksite, and flight data.</span>
            <button className="sample-link" type="button" onClick={loadSample}>
              Preview with 3,000 sample requests
            </button>
          </div>
        ) : (
          <div className="table-host"><div ref={tableElement} /></div>
        )}
        <footer className="table-footer">
          <span><span className="footer-dot" /> {ready ? 'Changes are held until saved' : 'No data loaded'}</span>
          <span>{changeCount ? `${changeCount} unsaved change${changeCount === 1 ? '' : 's'}` : 'No unsaved changes'}</span>
        </footer>
          </div>
        ) : (
          <div id="additional-workers-panel" role="tabpanel" aria-labelledby="additional-workers-tab">
            <div className="table-toolbar">
              <div className="table-title"><span className="section-index">02</span><h2>Request additional workers</h2><span className="count-chip">{temporaryWorkers.length}</span></div>
            </div>
            <div className="worker-request-panel">
              <p className="worker-request-intro">Add workers for one farm at a time. Select another farm and add more workers to build a multi-farm request. Names and contact details are optional.</p>
              <div className="worker-request-controls">
                <label>
                  Farm
                  <select value={workerFarm} onChange={(event) => setWorkerFarm(event.target.value)} disabled={!ready || saving} required>
                    <option value="">Select a farm</option>
                    {worksites.map((worksite) => <option key={worksite} value={worksite}>{worksite}</option>)}
                  </select>
                </label>
                <label>
                  Number of workers
                  <input
                    type="number"
                    min="1"
                    max={MAX_WORKERS_PER_ADD}
                    step="1"
                    value={workerCount}
                    onChange={(event) => setWorkerCount(event.target.value)}
                    disabled={!ready || saving}
                  />
                </label>
                <button className="button button-outline" type="button" onClick={addTemporaryWorkers} disabled={!ready || saving}>
                  Add workers
                </button>
              </div>
              {workerError && <p className="form-error" role="alert">{workerError}</p>}
              {!ready ? (
                <p className="worker-empty">Waiting for the farm list from Laserfiche.</p>
              ) : temporaryWorkers.length === 0 ? (
                <p className="worker-empty">No additional workers added yet.</p>
              ) : (
                <div className="worker-list-wrap">
                  <table className="worker-list">
                    <thead>
                      <tr><th>Farm</th><th>Name (optional)</th><th>Phone number (optional)</th><th>Email (optional)</th><th>Save status</th><th><span className="sr-only">Actions</span></th></tr>
                    </thead>
                    <tbody>
                      {temporaryWorkers.map((worker, index) => (
                        <tr key={worker.__lfRowId}>
                          <td>{worker.Farm}</td>
                          <td><input aria-label={`Name for new worker request ${index + 1}`} value={worker.FullName} onChange={(event) => updateTemporaryWorker(worker.__lfRowId, 'FullName', event.target.value)} disabled={saving || worker.Saved} /></td>
                          <td><input aria-label={`Phone number for new worker request ${index + 1}`} type="tel" value={worker.PhoneNumber} onChange={(event) => updateTemporaryWorker(worker.__lfRowId, 'PhoneNumber', event.target.value)} disabled={saving || worker.Saved} /></td>
                          <td><input aria-label={`Email for new worker request ${index + 1}`} type="email" value={worker.Email} onChange={(event) => updateTemporaryWorker(worker.__lfRowId, 'Email', event.target.value)} disabled={saving || worker.Saved} /></td>
                          <td>{worker.Saved ? 'Saved' : 'Pending'}</td>
                          <td><button className="remove-worker" type="button" onClick={() => removeTemporaryWorker(worker.__lfRowId)} disabled={saving} aria-label={`Remove new worker request ${index + 1}`}>Remove</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <footer className="table-footer">
              <span><span className="footer-dot" /> {ready ? 'Additional requests are held until saved' : 'No data loaded'}</span>
              <span>{unsavedWorkerCount} pending, {temporaryWorkers.length - unsavedWorkerCount} saved</span>
            </footer>
          </div>
        )}
      </section>

      <div className="save-bar">
        <span>{saveNotice || (pendingChangeCount
          ? `${changeCount} employee change${changeCount === 1 ? '' : 's'} and ${unsavedWorkerCount} new worker request${unsavedWorkerCount === 1 ? '' : 's'} ready to save`
          : 'No changes to send yet')}</span>
        <button className="button button-save" type="button" onClick={saveChanges} disabled={!ready || pendingChangeCount === 0 || saving}>
          {saving ? 'Saving changes...' : 'Save all changes'} <span aria-hidden="true">↗</span>
        </button>
      </div>
    </main>
  )
}

export default App

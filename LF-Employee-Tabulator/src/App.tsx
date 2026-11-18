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
  Flight_Type: string
}

const FLIGHT_FIELDS = [
  'Flight_Number',
  'Flight_Carrier',
  'Flight_Origin',
  'Flight_Destination',
  'Flight_Date',
  'Flight_Time',
  'Flight_Type',
] as const
const FLIGHT_DEFINITION_FIELDS = FLIGHT_FIELDS.filter((field) => field !== 'Flight_Number')

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
    const flightType = requestStatus === 'Request Return' ||
      requestStatus === 'Return Flight Booked'
      ? 'Departure'
      : 'Arrival'
    const assignedFlight = employeeFlights.find(
      (flight) => String(flight.Flight_Type ?? '').toLowerCase() === flightType.toLowerCase(),
    ) ?? {}
    const flightNumber = String(assignedFlight.Flight_Number ?? '')
    const flight = flightByNumber.get(flightNumber) ?? assignedFlight
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
      Flight_Type: String(flight.Flight_Type ?? ''),
      __lfRowId: `request-${index}`,
    }
  })
}

function toRequestPayload(row: RequestRow): Record<string, unknown> {
  return {
    Employee_Number: row.Employee_Number,
    Request_Status: row.Request_Status,
    Farm: row.Farm,
    Preferred_Arrival_By: dateTimeForLaser(row.Preferred_Arrival_By, ''),
    Flight_Number: row.Flight_Number,
    Flight_Carrier: row.Flight_Carrier,
    Flight_Origin: row.Flight_Origin,
    Flight_Destination: row.Flight_Destination,
    Flight_DateTime: dateTimeForLaser(row.Flight_Date, row.Flight_Time),
    Flight_Type: row.Flight_Type,
  }
}

function flightDefinition(row: EmployeeRow): Record<string, unknown> {
  return Object.fromEntries(
    FLIGHT_DEFINITION_FIELDS.map((field) => [field, row[field] ?? '']),
  )
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
): HTMLInputElement {
  const input = document.createElement('input')
  const datalist = document.createElement('datalist')
  const listId = `flight-options-${crypto.randomUUID()}`
  let completed = false

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

const REQUEST_STATUS_TRANSITIONS: Record<string, string[]> = {
  '': ['Requested'],
  Requested: [''],
  Arrived: ['Request Return'],
  'Request Return': ['Arrived'],
}
const BOOKED_REQUEST_STATUSES = new Set(['Flight Booked', 'Return Flight Booked'])
const FLIGHT_EDITABLE_REQUEST_STATUSES = new Set(['Requested', 'Request Return'])
const EMPTY_REQUEST_STATUS_FILTER = '__empty_request_status__'
const EMPTY_FARM_FILTER = '__empty_farm__'

function allowedRequestStatusTransitions(role: UserRole | null, status: string): string[] {
  if (role === 'HR') {
    if (status === 'Requested') return ['Flight Booked']
    if (status === 'Request Return') return ['Return Flight Booked']
    return []
  }
  if (role === 'Manager') {
    return (REQUEST_STATUS_TRANSITIONS[status] ?? []).filter(
      (nextStatus) => nextStatus === 'Requested' || nextStatus === 'Request Return',
    )
  }
  return []
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
    return FLIGHT_EDITABLE_REQUEST_STATUSES.has(requestStatus)
  }
  if (
    role === 'HR' &&
    (FLIGHT_DEFINITION_FIELDS as readonly string[]).includes(field)
  ) {
    return FLIGHT_EDITABLE_REQUEST_STATUSES.has(requestStatus) &&
      Boolean(rowData.Flight_Number)
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
) {
  const rowData = row.getData() as EmployeeRow
  for (const cell of row.getCells()) {
    const columnEditable = cell.getColumn().getDefinition().editable !== false
    cell.getElement().classList.toggle(
      'is-editable',
      isCellEditable(role, rowData, String(cell.getField()), columnEditable),
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

function requestColumns(
  worksites: string[],
  flightOptions: Record<string, string>,
  role: UserRole,
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
        flightNumberEditor(cell, onRendered, success, cancel, flightOptions),
    },
    { title: 'Carrier', field: 'Flight_Carrier', minWidth: 120, widthGrow: 1.3 },
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
    {
      title: 'Flight type',
      field: 'Flight_Type',
      minWidth: 100,
      widthGrow: 0.9,
      editor: 'list',
      editorParams: { values: ['Arrival', 'Departure'] },
    },
  ]
}

function App() {
  const tableElement = useRef<HTMLDivElement>(null)
  const table = useRef<Tabulator | null>(null)
  const formWindow = useRef<Window | null>(null)
  const previewMode = useRef(false)
  const role = useRef<UserRole | null>(null)
  const targetOrigin = useRef('*')
  const flightDefinitions = useRef(new Map<string, Record<string, unknown>>())
  const flightOptions = useRef<Record<string, string>>({})
  const originalRows = useRef(new Map<string, string>())
  const originalFlightRows = useRef(new Map<string, string>())
  const updatedRows = useRef(new Map<string, EmployeeRow>())
  const [columns, setColumns] = useState<ColumnDefinition[]>([])
  const [rows, setRows] = useState<EmployeeRow[]>([])
  const [ready, setReady] = useState(false)
  const [message, setMessage] = useState('Waiting for employee data from Laserfiche')
  const [changeCount, setChangeCount] = useState(0)
  const [rowCount, setRowCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveNotice, setSaveNotice] = useState('')

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

  function updateFlightDefinition(flightNumber: string, row: EmployeeRow) {
    if (flightNumber) {
      flightDefinitions.current.set(flightNumber, {
        Flight_Number: flightNumber,
        ...flightDefinition(row),
      })
    }
  }

  function clearFlightDefinition(row: RowComponent) {
    row.update({
      Flight_Carrier: '',
      Flight_Origin: '',
      Flight_Destination: '',
      Flight_Date: '',
      Flight_Time: '',
      Flight_Type: '',
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
      Flight_Type: definition.Flight_Type ?? '',
    })
  }

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data

      if (data?.type === 'employee-request:saved') {
        setSaving(false)
        setSaveNotice(`${Number(data.rowsSaved) || 0} employee travel row(s) saved to the form.`)
        return
      }

      if (data?.type === 'employee-request:save-error') {
        setSaving(false)
        setSaveNotice(`The form could not save employee travel rows: ${String(data.message ?? 'Unknown error')}`)
        return
      }

      if (data?.type === 'employee-tabulator:hello') {
        if (event.source && event.origin !== 'null') {
          formWindow.current = event.source as Window
          console.log('Replying ready to hello sender', event.origin)
          ;(event.source as Window).postMessage(
            { type: 'employee-tabulator:ready' },
            event.origin,
          )
        }
        return
      }

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
      const worksites = [...new Set(worksiteValues.map((worksite) => {
        if (typeof worksite === 'string') return worksite
        if (!worksite || typeof worksite !== 'object') return ''
        const entry = worksite as Record<string, unknown>
        return String(entry.Worksite ?? entry.Farm ?? entry.Name ?? entry.data ?? '')
      }).filter(Boolean))]
      const normalizedRows = buildRequestRows(employeeRows, flightRows)
      const definitions = new Map<string, Record<string, unknown>>()
      for (const flight of flightRows) {
        const flightNumber = String(flight.Flight_Number ?? '')
        if (flightNumber && !definitions.has(flightNumber)) {
          definitions.set(flightNumber, flight)
        }
      }
      flightDefinitions.current = definitions
      for (const key of Object.keys(flightOptions.current)) delete flightOptions.current[key]
      for (const flightNumber of definitions.keys()) {
        flightOptions.current[flightNumber] = flightNumber
      }

      targetOrigin.current = event.origin === 'null' ? '*' : event.origin
      if (event.source) formWindow.current = event.source as Window
      originalRows.current = new Map(
        normalizedRows.map((row) => [row.__lfRowId, requestSnapshot(row)]),
      )
      originalFlightRows.current = new Map(
        normalizedRows.map((row) => [row.__lfRowId, flightSnapshot(row)]),
      )
      updatedRows.current.clear()
      setChangeCount(0)
      setColumns(requestColumns(worksites, flightOptions.current, receivedRole))
      setRows(normalizedRows)
      setRowCount(normalizedRows.length)
      setReady(true)
      setMessage('')
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  useEffect(() => {
    if (!ready || !tableElement.current) return

    const editableColumns = columns.map((column) => ({
      ...column,
      editor: column.editor ?? 'input',
      editable: (cell: { getRow: () => RowComponent; getField: () => string }) => {
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
        updateEditableCellStyles(row, role.current),
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
        } else {
          for (const target of affectedRows) clearFlightDefinition(target)
          updateFlightDefinition(flightNumber, row.getData() as EmployeeRow)
        }
        if (flightNumber) flightOptions.current[flightNumber] = flightNumber
        for (const target of affectedRows) trackUpdate(target.getData() as EmployeeRow)
        return
      }

      const rowData = row.getData() as EmployeeRow
      const flightNumber = String(rowData.Flight_Number ?? '')
      if (flightNumber && (FLIGHT_DEFINITION_FIELDS as readonly string[]).includes(field)) {
        const updates = { [field]: rowData[field] }
        for (const target of matchingFlightRows(flightNumber, rowData.__lfRowId)) {
          target.update(updates)
          trackUpdate(target.getData() as EmployeeRow)
        }
        updateFlightDefinition(flightNumber, rowData)
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
  }, [columns, ready, rows])

  function saveChanges() {
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

    if (previewMode.current) {
      for (const row of changedRows) {
        originalRows.current.set(row.__lfRowId, requestSnapshot(row))
        originalFlightRows.current.set(row.__lfRowId, flightSnapshot(row))
      }
      updatedRows.current.clear()
      setChangeCount(0)
      setSaveNotice('Employee travel updates saved in preview.')
      return
    }

    const invalidRows = changedRows.filter((row) => {
      const flightChanged = originalFlightRows.current.get(row.__lfRowId) !== flightSnapshot(row)
      const flightIsBlank = FLIGHT_FIELDS.every(
        (field) => row[field] == null || row[field] === '',
      )
      const isBooked = BOOKED_REQUEST_STATUSES.has(String(row.Request_Status ?? ''))
      return !row.Employee_Number ||
        (isBooked && (!row.Flight_Number || !['Arrival', 'Departure'].includes(String(row.Flight_Type)))) ||
        (flightChanged && !flightIsBlank &&
          (!row.Flight_Number || !['Arrival', 'Departure'].includes(String(row.Flight_Type))))
    })
    if (invalidRows.length) {
      setSaveNotice('Choose an existing flight number or enter a flight number and type before saving.')
      return
    }

    const payload: RequestChangeSet = {
      type: 'employee-request:save',
      requests: (changedRows as RequestRow[]).map(toRequestPayload),
    }
    ;(formWindow.current ?? window.parent).postMessage(payload, targetOrigin.current)
    updatedRows.current.clear()
    setChangeCount(0)
    setSaveNotice('Employee travel updates sent to the form.')
    setSaving(true)
  }

  function loadSample() {
    const employees = Array.from({ length: 3000 }, (_, index) => ({
      Employee_Number: `LF-${String(index + 1).padStart(4, '0')}`,
      FullName: ['Morgan Chen', 'Avery Patel', 'Jordan Rivera', 'Riley Wilson'][index % 4],
      Status: ['Active', 'Terminated', 'Active', 'Active'][index % 4],
    }))
    previewMode.current = true
    targetOrigin.current = window.location.origin
    role.current = 'HR'
    const worksites = ['Cedar Creek', 'Pine Ridge', 'Maple Grove', 'Willow Creek']
    const flights = employees.map((employee, index) => {
      const status = [
        '',
        'Requested',
        'Arrived',
        'Request Return',
        'Flight Booked',
        'Return Flight Booked',
      ][index % 6]
      const flightType = status === 'Request Return' || status === 'Return Flight Booked'
        ? 'Departure'
        : 'Arrival'
      const hasFlight = BOOKED_REQUEST_STATUSES.has(status) ||
        (FLIGHT_EDITABLE_REQUEST_STATUSES.has(status) && index % 2 === 1)
      const day = String((index % 27) + 1).padStart(2, '0')
      const flightDay = String(
        (flightType === 'Arrival' ? 20 : 10) + (index % 4),
      ).padStart(2, '0')
      return {
        Employee_Number: employee.Employee_Number,
        Request_Status: status,
        Farm: status ? worksites[index % worksites.length] : '',
        Requested_Arrival: status ? { dateStr: `2026-12-${day}` } : '',
        Flight_Number: hasFlight
          ? `LF${flightType === 'Arrival' ? 420 : 430}${index % 4}`
          : '',
        Flight_Carrier: hasFlight ? 'Northstar Air' : '',
        Flight_Origin: hasFlight ? 'YVR' : '',
        Flight_Destination: hasFlight ? 'YYZ' : '',
        Flight_Date: hasFlight
          ? { dateStr: `2026-12-${flightDay}`, timeStr: '08:30:00 AM' }
          : '',
        Flight_Type: hasFlight ? flightType : '',
      }
    })
    const sampleRows = buildRequestRows(employees, flights)
    flightDefinitions.current = new Map(
      flights.filter((flight) => flight.Flight_Number).map((flight) => [
        String(flight.Flight_Number),
        flight,
      ]),
    )
    for (const key of Object.keys(flightOptions.current)) delete flightOptions.current[key]
    for (const flightNumber of flightDefinitions.current.keys()) {
      flightOptions.current[flightNumber] = flightNumber
    }
    originalRows.current = new Map(
      sampleRows.map((row) => [row.__lfRowId, requestSnapshot(row)]),
    )
    originalFlightRows.current = new Map(
      sampleRows.map((row) => [row.__lfRowId, flightSnapshot(row)]),
    )
    updatedRows.current.clear()
    setChangeCount(0)
    setColumns(requestColumns(worksites, flightOptions.current, 'HR'))
    setRows(sampleRows)
    setRowCount(sampleRows.length)
    setReady(true)
    setMessage('')
  }

  return (
    <main className="workspace">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">LF</div>
        <div className="brand-copy"><span>PEOPLE OPERATIONS</span><strong>Employee travel</strong></div>
        <div className="connection"><span className={ready ? 'connection-dot is-live' : 'connection-dot'} />{ready ? 'Form connected' : 'Awaiting form data'}</div>
      </header>

      <section className="page-heading">
        <div>
          <p className="eyebrow">PEOPLE OPERATIONS <span>/</span> EMPLOYEE TRAVEL</p>
          <h1>Employee travel requests</h1>
          <p className="subheading">Track employee hiring and return requests, worksites, and flight details.</p>
        </div>
        <div className="record-total"><strong>{rowCount.toLocaleString()}</strong><span>records</span></div>
      </section>

      <section className="table-section" aria-label="Employee records">
        <div className="table-toolbar">
          <div className="table-title"><span className="section-index">01</span><h2>Employee travel requests</h2><span className="count-chip">{rowCount.toLocaleString()}</span></div>
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
      </section>

      <div className="save-bar">
        <span>{saveNotice || (changeCount ? `${changeCount} change${changeCount === 1 ? '' : 's'} ready to send` : 'No changes to send yet')}</span>
        <button className="button button-save" type="button" onClick={saveChanges} disabled={!ready || !changeCount || saving}>
          {saving ? 'Changes sent' : 'Save changes'} <span aria-hidden="true">↗</span>
        </button>
      </div>
      <div className="page-foot"><span>LASERFICHE CLOUD FORM INTEGRATION</span><span>EMPLOYEE DATA</span></div>
    </main>
  )
}

export default App

# LF Employee Tabulator

A hosted employee register for embedding in a Laserfiche Cloud form. Tabulator virtualizes the rows so the page remains responsive with 3,000+ records.

## Run locally

```sh
npm install
npm run dev
```

Use **Preview with 3,000 sample records** to exercise the grid without a form.

## Deploy to GitHub Pages

The repository includes a GitHub Actions deployment workflow. In GitHub, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**. Push the `main` branch or run **Deploy to GitHub Pages** from the Actions tab to publish the site.

The live site URL is <https://daletools.github.io/LF-Employee-Tabulator/>. The workflow installs from this app's lockfile, builds the Vite site with the `/LF-Employee-Tabulator/` base path, and deploys the build artifact. Local development continues to use `/`.

## Laserfiche iframe setup

Embed the hosted page in two separate iframe fields:

- Flight management: `https://daletools.github.io/LF-Employee-Tabulator/`
- Employee requests (field 68): `https://daletools.github.io/LF-Employee-Tabulator/?view=employee-request`

The form script reads employees from table field `44` and farm choices from field `70`. It sends request data after the employee table (field `47`), Employee Flights lookup (field `57`), and farm table (field `70`) report changes. Employee Flights fields `80`, `82`, and `83` supply request status, farm, and requested arrival date. Flight rows are matched by employee number; the Arrival row supplies the assigned flight number and date/time. The request page shows employee number, full name, current status, request status, farm, requested arrival, and the shared flight fields: number, carrier, origin, destination, date, time, and type. Request-view init data must include `Role: "HR"` or `Role: "Manager"`; a missing or unrecognized role leaves the request view read-only and displays an error. HR may edit flight fields while Request Status is `Requested` or `Request Return`, and may set those statuses to `Flight Booked` or `Return Flight Booked`, respectively. Managers may set a blank status to `Requested` and `Arrived` to `Request Return`; Farm and requested arrival follow the existing status rules and are editable only for nonblank statuses other than `Arrived` and the booked statuses. `Flight Booked` and `Return Flight Booked` keep Request Status and flight fields read-only. Preferred arrival dates are constrained to tomorrow or later.

The form script probes child frames with `employee-tabulator:hello`; each hosted page replies with `employee-tabulator:ready` and its view. The script keeps the flight and request frames separate and sends each its matching `employee-tabulator:init` payload. The flight page uses the contract below. The request page receives:

```js
{
  type: "employee-tabulator:init",
  view: "employee-request",
  data: {
    Role: "HR",
    employees: [
      { Employee_Number: "4790", FullName: "Diaz Rodriguez, Camila", Status: "Active" },
    ],
    farms: ["North Farm", "South Farm"],
    requests: [
      {
        Employee_Number: "4790",
        Request_Status: "Requested",
        Farm: "North Farm",
        Preferred_Arrival_By: { dateStr: "2026-10-20" },
        Flight_Number: "AC123",
        Flight_Arrival: { dateStr: "2026-10-18", timeStr: "08:30:00 AM" },
        Departure_Airport: "YVR",
        Arrival_Airport: "YYZ",
      },
    ],
    flights: [
      {
        Employee_Number: "4790",
        Flight_Number: "AC123",
        Flight_Carrier: "Air Canada",
        Flight_Origin: "YVR",
        Flight_Destination: "YYZ",
        Flight_Date: { dateStr: "2026-10-18", timeStr: "08:30:00 AM" },
        Flight_Type: "Arrival",
      },
    ],
  },
}
```

For existing flight-number suggestions, include the full flight definitions in `data.flights` using the same shape as the flight iframe contract below. The request view can also seed suggestions from flight numbers already assigned to request rows. Selecting an existing number fills its shared flight details; entering a new number clears the details for manual entry. Editing a flight detail updates every request row using that number. These flight edits are validated and sent as `{ type: "employee-tabulator:save", flights: [...] }`, using the same table-field `59` integration as the flight iframe.

Saving request edits also sends `{ type: "employee-request:save", requests: [...] }` to the form script. Each request contains `Employee_Number`, `FullName`, `Request_Status`, `Farm`, `Preferred_Arrival_By`, `Flight_Number`, and `Flight_Arrival`; date values use the LFForm DateTime shape `{ dateStr, timeStr? }`. The form appends saved requests to table field `71`, mapping employee number, full name, request status, farm, preferred arrival, flight number, and flight arrival to fields `72` through `78`. Blank request status, farm, or flight number values are stored as `Cancel`, `TBD`, and `TBD`; blank dates are stored as `{ dateStr: "1900-01-01" }`. Flight origin and destination are saved with the flight definition as its origin and destination; the request table itself has no airport output fields.

## Flight iframe data contract

The form script sends one object after the employee table is populated and the lookup triggered by `Flight_Type` completes:

```js
{
  type: "employee-tabulator:init",
  data: {
    employees: [
      { Employee_Number: "4790", FullName: "Diaz Rodriguez, Camila", Status: "Active" },
    ],
    flights: [
      {
        Employee_Number: "4790",
        Flight_Number: "AC123",
        Flight_Carrier: "Air Canada",
        Flight_Origin: "YVR",
        Flight_Destination: "YYZ",
        Flight_Date: { dateStr: "2026-10-01", timeStr: "08:30:00 AM" },
        Flight_Type: "Departure",
      },
    ],
  },
}
```

The grid joins each flight to its employee by `Employee_Number`; employees with no flight get a blank flight row. Employee number, full name, and status are read-only. Unlocking a row enables only flight fields. Flight Number suggestions come from existing flight data, but free-text values are allowed for defining new flights. Selecting a known number fills its carrier, route, date/time, and type. Editing a nonblank flight's definition updates every row sharing that flight number. Selecting the blank option clears those fields and marks each affected employee row for deletion. Flight type is restricted to `Arrival` or `Departure` for assigned flights. Dates and times are sent back as the LFForm DateTime object `{ dateStr, timeStr? }`.

On **Save changes**, the page first drops any touched row that matches its original flight data, then sends `{ type: "employee-tabulator:save", flights: [...] }` directly to the form sandbox. Assigned flights and deletion markers (employee number plus blank flight fields) are appended as new rows in table field `59`, setting fields `60` through `66` in order: employee number, flight number, carrier, origin, destination, DateTime, and flight type. A later process can interpret blank flight fields as a deletion request. The source employee and flight tables are fields `44` and `50`; flight columns are fields `51` through `57`. The form waits for changes to fields `47` and `57` before sending the initial snapshot.

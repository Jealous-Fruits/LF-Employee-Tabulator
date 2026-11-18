# LF Employee Tabulator

A hosted employee register for embedding in a Laserfiche Cloud form. Tabulator virtualizes the rows so the page remains responsive with 3,000+ records.

## Run locally

```sh
npm install
npm run dev
```

Use **Preview with 3,000 sample requests** to exercise the grid without a form.

## Deploy to GitHub Pages

The repository includes a GitHub Actions deployment workflow. In GitHub, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**. Push the `main` branch or run **Deploy to GitHub Pages** from the Actions tab to publish the site.

The live site URL is <https://daletools.github.io/LF-Employee-Tabulator/>. The workflow installs from this app's lockfile, builds the Vite site with the `/LF-Employee-Tabulator/` base path, and deploys the build artifact. Local development continues to use `/`.

## Laserfiche iframe setup

Embed one hosted page at <https://daletools.github.io/LF-Employee-Tabulator/>. The URL does not use a `view` parameter; the supplied Role determines which fields are editable.

The form script reads employees from table field `93`, worksite choices from field `112`, Role from field `110`, and flight data from fields `100` through `106`. Fields `80`, `82`, and `83` provide request status, farm, and preferred arrival/departure date for the flight rows. The employee table-ready signal is field `97`.

The grid displays employee number, name, current status, request status, worksite, preferred arrival/departure, and the selected flight's number, carrier, origin, destination, date, time, and type. `Request Return` and `Return Flight Booked` rows use the employee's Departure flight; other statuses use the Arrival flight. Request Status, worksite, and preferred date are per employee; edits to a flight's carrier, route, date, time, or type update all displayed employees using that flight number.

The Current Status and Request Status header filters are dropdowns. The Farm filter is also a dropdown, with the supplied worksite choices and a Blank option.

Only `HR` and `Manager` are recognized roles. An absent or unknown role leaves the grid read-only and displays an error. HR may edit flight fields while Request Status is `Requested` or `Request Return`, and may move those statuses to `Flight Booked` or `Return Flight Booked`, respectively. Managers may set a blank status to `Requested` and `Arrived` to `Request Return`; Farm and requested date are editable only for eligible nonblank statuses other than `Arrived` and the booked statuses. Booked statuses keep Request Status and flight fields read-only. Preferred arrival/departure dates are constrained to tomorrow or later.

The form script probes the hosted iframe with `employee-tabulator:hello`; it replies with `employee-tabulator:ready` and receives one `employee-tabulator:init` payload:

```js
{
  type: "employee-tabulator:init",
  data: {
    Role: "HR",
    employees: [
      { Employee_Number: "4790", FullName: "Diaz Rodriguez, Camila", Status: "Active" },
    ],
    worksites: ["North Farm", "South Farm"],
    flights: [
      {
        Employee_Number: "4790",
        Request_Status: "Requested",
        Farm: "North Farm",
        Requested_Arrival: { dateStr: "2026-10-20" },
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

Selecting an existing flight number fills its carrier, route, date/time, and type; entering a new number clears those details for manual entry. Flight type is `Arrival` or `Departure`. Date/time values use the LFForm DateTime shape `{ dateStr, timeStr? }`.

On **Save changes**, the page sends one `{ type: "employee-request:save", requests: [...] }` message. Each changed row includes employee number, request status, farm, preferred date, flight number, carrier, origin, destination, combined flight date/time, and flight type. The form appends these rows to output table field `71` using:

| Output column | Field ID |
| --- | ---: |
| Employee Number | 72 |
| Request Status | 74 |
| Farm | 75 |
| Preferred Arrival/Departure | 76 |
| Flight Number | 77 |
| Carrier | 113 |
| Origin | 114 |
| Destination | 115 |
| Flight Date and Time | 116 |
| Flight Type | 117 |

Blank request status, farm, and flight number values are written as `Cancel`, `TBD`, and `TBD`; blank dates use `{ dateStr: "1900-01-01" }`. There is no separate flight output table or second iframe.

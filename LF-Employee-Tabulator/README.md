# LF Employee Tabulator

A hosted employee register for embedding in a Laserfiche Cloud form. Tabulator virtualizes the rows so the page remains responsive with 3,000+ records.

## Run locally

```sh
npm install
npm run dev
```

The app requires an embedded Laserfiche form to provide employee, worksite, flight, and role data. When run directly without the form connection, it remains in the waiting state.

## Deploy to GitHub Pages

The repository includes a GitHub Actions deployment workflow. In GitHub, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**. Push the `main` branch or run **Deploy to GitHub Pages** from the Actions tab to publish the site.

The live site URL is <https://jealous-fruits.github.io/LF-Employee-Tabulator/>. The workflow installs from this app's lockfile, builds the Vite site with the `/LF-Employee-Tabulator/` base path, and deploys the build artifact. Local development continues to use `/`.

## Laserfiche iframe setup

Embed one hosted page at <https://jealous-fruits.github.io/LF-Employee-Tabulator/>. The URL does not use a `view` parameter; the supplied Role determines which fields are editable.

The form script reads employees from table field `93`, worksite choices from field `112`, Role from field `110`, employee PII from table field `123`, employee workprograms from table field `124`, and active flight details from fields `100` through `105`. The lookup-done signals for the PII and workprogram tables are fields `128` and `129`; the employee table-ready signal is field `97`. Fields `107`, `109`, and `108` provide request status, farm, and preferred arrival/departure date for the flight rows. Fields `106` and `117` are not accessed.

The grid displays employee number, name, Work Program, current status, request status, worksite, preferred arrival/departure, and the employee's active flight number, carrier, destination, date, and time. Birthdate is displayed to HR users only. Work Program and Birthdate are read-only. The Origin column is hidden but its data remains in the request rows and save flow. Only one active flight record is maintained per employee. Request Status, worksite, and preferred date are per employee; edits to a flight's carrier, route, date, or time update all displayed employees using that flight number.

The Current Status and Request Status header filters are dropdowns. The Farm filter is also a dropdown, with the supplied worksite choices and a Blank option.

The **Additional workers** tab allows any user to request a quantity of workers for a selected farm (up to 1,000 per add action), with optional name, Work Program, phone number, and email per worker. Work Program choices are `Canadian`, `LMIA`, `(AG-GUAT)`, `(AG-JAM)`, `(AG-MEX)`, `(AG-OTHER)`, `(SAWP-JAM)`, and `(SAWP-MEX)`. Add another batch after selecting a different farm to make a multi-farm request. Each generated worker receives a unique negative employee number for routing as a temporary worker within the current page session. These rows are sent through the save message with Request Status `Requested`; flight and preferred-date fields remain blank/default. The selected Work Program is included in the message to the form, but is not yet written to an output-table field. Saved worker rows stay visible and can be removed before submitting the form; removal deletes the matching temporary-worker row from output table `71`. This removal control applies only to additional-worker requests; saved employee request rows cannot currently be removed from the page.

Only `HR` and `Manager` are recognized roles. An absent or unknown role leaves the grid read-only and displays an error. Available transitions are:

| Role | Current status | Allowed next statuses |
| --- | --- | --- |
| Manager | Blank | Requested |
| Manager | Requested | Blank |
| Manager | Arrived | Request Return |
| Manager | Request Return | Arrived |
| HR | Requested | Flight Booked |
| HR | Flight Booked | Requested, Arrived, Flight Missed, Request Return |
| HR | Flight Missed | Flight Booked |
| HR | Request Return | Flight Booked |

Farm and requested date are editable for eligible Manager statuses other than Blank, `Arrived`, and booked statuses. Flight fields are editable for HR only in booked statuses; carrier, route, date, and time remain locked until a flight number is entered. The legacy `Return Flight Booked` status remains available for existing records, but is not offered as a transition. Preferred arrival/departure dates are constrained to tomorrow or later.

The employee grid labels the employee's existing status as **Status** and the request workflow status as **Request**.

The hosted iframe is already embedded in the form. The LFForm sandbox sends `employee-tabulator:hello` to child frames using the exact hosted origin as `targetOrigin`, retrying for up to 60 seconds. The hosted page accepts messages only from `https://sandbox-forms.laserfiche.ca`, replies to the hello sender with `employee-tabulator:ready`, then accepts init and save acknowledgements only from that same sandbox window. Messages back to Laserfiche target the sandbox origin; the page does not use `window.parent` as the data channel.

The page receives one `employee-tabulator:init` payload:

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
      },
    ],
  },
}
```

Employee records are joined by employee number with field `123` and field `124`, after both lookup-done signals have fired. Each employee includes `Birthdate` (the source DateTime value or blank) and `Workprogram` (the source value or blank). When the initial packet is built, the form script logs the raw values returned from both source tables and up to five joined employee records in the browser console for verification. The raw PII table includes birthdates and employee numbers; treat the console output as sensitive.

Autocomplete suggestions include flights with a future date and flights today only when their time is still ahead; past or undated flights are not suggested. Existing flight data remains available for lookup if a number is entered manually. Selecting an existing flight number fills its carrier, route, and date/time; entering a new number clears those details for manual entry. Date/time values use the LFForm DateTime shape `{ dateStr, timeStr? }`.

The Airline column is a dropdown with Air Canada, WestJet, Porter Airlines, Air Transat, Flair Airlines, and Canadian North. Existing carrier values outside this list are preserved until changed.

**Save all changes** saves pending employee edits and unsaved additional-worker requests together, regardless of which tab is open. The page sends one `{ type: "employee-request:save", requests: [...] }` message. Each changed row includes employee number, request status, farm, preferred date, flight number, carrier, origin, destination, and combined flight date/time. The form appends these rows to output table field `71` using:

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
| Phone Number | 118 |
| Email | 119 |
| New Hire Name | 120 |

Blank request status, farm, and flight number values are written as `Cancel`, `TBD`, and `TBD`; blank dates use `{ dateStr: "1900-01-01" }`. New Hire Name is populated only for temporary workers with a negative employee number and is blank when not provided; it remains blank for standard employee requests. Phone number and email are blank when not provided. There is no separate flight output table or second iframe.

After a save starts, the bridge overwrites CustomHTML field `122` with a saving notice. After a successful save, it overwrites the field with a Review summary of all successful saves in the current page session, including employee names and flight details. Specific new-worker requests (those with a name or contact information) are listed individually under **Specific New Worker Requests**; anonymous requests are grouped by farm under **Unspecified New Worker Requests**. Temporary negative employee numbers are not shown in the summary. Removing a saved new-worker request also updates the summary. The summary is held in memory and does not persist across a page reload.

The form's `Submit_Status` field (default `True`) is a submission latch. The bridge sets it to `False` before writing output rows and back to `True` only after all writes succeed. The `onFormSubmission` handler blocks submission while the latch is false or the save has failed.

The page also requests the browser's generic before-unload confirmation while employee changes are pending or have been saved into the form but not submitted. The form checks for pending page edits before allowing submission; on a valid submission, it clears the warning so the browser does not interrupt the submit flow. Browser policy and the Laserfiche iframe configuration control whether the confirmation appears, so this is a best-effort warning rather than a guarantee.

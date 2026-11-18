const FIELD_IDS = Object.freeze({
  employeeTable: 93,
  employeeTableReady: 97,
  flight: {
    employeeNumber: 100,
    number: 101,
    carrier: 102,
    origin: 103,
    destination: 104,
    date: 105,
    type: 106,
  },
  request: {
    role: 110,
    farmTable: 112,
    outputTable: 71,
    output: {
      employeeNumber: 72,
      status: 74,
      farm: 75,
      preferredArrival: 76,
      flightNumber: 77,
      carrier: 113,
      origin: 114,
      destination: 115,
      flightDateTime: 116,
      flightType: 117,
    },
    flightStatus: 80,
    flightFarm: 82,
    requestedArrival: 83,
  },
});

function debounce(func, delay = 500) {
  let timeoutId;

  return function (...args) {
    // 1. Clear any existing timer to reset the delay window
    clearTimeout(timeoutId);

    // 2. Set a new timer to execute the function after the delay
    timeoutId = setTimeout(() => {
      func.apply(this, args);
    }, delay);
  };
}

function toTabulatorData(input) {
  const records = Array.isArray(input) ? input : [input];

  const componentsByRow = records.map((record) =>
    Object.values(record ?? {}).filter(
      (item) =>
        item &&
        typeof item === "object" &&
        item.settings?.label &&
        Object.hasOwn(item, "data"),
    ),
  );

  const columnMap = new Map();

  for (const components of componentsByRow) {
    for (const component of components) {
      const { label, attributeName } = component.settings;
      const field = attributeName || label;

      if (!columnMap.has(field)) {
        columnMap.set(field, { title: label, field });
      }
    }
  }

  const columns = [...columnMap.values()];
  const rows = componentsByRow.map((components) => {
    const row = Object.fromEntries(columns.map(({ field }) => [field, ""]));

    for (const component of components) {
      const field =
        component.settings.attributeName || component.settings.label;
      row[field] = component.data ?? "";
    }

    return row;
  });

  return { columns, rows };
}

const TABULATOR_ORIGIN = "https://daletools.github.io";
let tabulatorWindow = null;
let helloTimer = null;
let employeeTableReady = false;
let flightLookupReady = false;
let farmTableReady = false;
let roleReady = false;
let initialDataSent = false;
let helloScanLogged = false;

console.info("[LF bridge] script started", {
  origin: window.location.origin,
  parentFrameCount: window.parent.frames.length,
});

function readTableColumn(fieldId) {
  const value = LFForm.getFieldValues({ fieldId });
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function readFlightRows() {
  const fields = {
    Employee_Number: readTableColumn(FIELD_IDS.flight.employeeNumber),
    Flight_Number: readTableColumn(FIELD_IDS.flight.number),
    Flight_Carrier: readTableColumn(FIELD_IDS.flight.carrier),
    Flight_Origin: readTableColumn(FIELD_IDS.flight.origin),
    Flight_Destination: readTableColumn(FIELD_IDS.flight.destination),
    Flight_Date: readTableColumn(FIELD_IDS.flight.date),
    Flight_Type: readTableColumn(FIELD_IDS.flight.type),
    Request_Status: readTableColumn(FIELD_IDS.request.flightStatus),
    Farm: readTableColumn(FIELD_IDS.request.flightFarm),
    Requested_Arrival: readTableColumn(FIELD_IDS.request.requestedArrival),
  };
  const rowCount = Math.max(
    0,
    ...Object.values(fields).map((values) => values.length),
  );

  return Array.from({ length: rowCount }, (_, index) =>
    Object.fromEntries(
      Object.entries(fields).map(([field, values]) => [
        field,
        values[index] ?? "",
      ]),
    ),
  );
}

function readEmployeeRows() {
  const employeeTable = LFForm.getFieldValues({
    fieldId: FIELD_IDS.employeeTable,
  });
  return toTabulatorData(employeeTable).rows.map((row) => ({
    Employee_Number: row.Employee_Number ?? row.EmployeeNumber ?? "",
    FullName: row.FullName ?? "",
    Status: row.Status ?? "",
  }));
}

function readUserRole() {
  if (!FIELD_IDS.request.role) return "";
  const roleValue = LFForm.getFieldValues({
    fieldId: FIELD_IDS.request.role,
  });
  const value = Array.isArray(roleValue) ? roleValue[0] : roleValue;
  if (value && typeof value === "object") {
    return String(value.data ?? value.value ?? value.label ?? "").trim();
  }
  return String(value ?? "").trim();
}

function buildEmployeeRequestPayload() {
  const farmValues = LFForm.getFieldValues({
    fieldId: FIELD_IDS.request.farmTable,
  });
  const worksites = [
    ...new Set(
      (Array.isArray(farmValues) ? farmValues : [farmValues])
        .map((farm) => {
          if (typeof farm === "string") return farm.trim();
          if (!farm || typeof farm !== "object") return "";
          return String(
            farm.Farm ??
              farm.Farm_Name ??
              farm.Name ??
              farm.data ??
              farm.value ??
              "",
          ).trim();
        })
        .filter(Boolean),
    ),
  ];

  const employees = readEmployeeRows();
  return {
    type: "employee-tabulator:init",
    data: {
      Role: readUserRole(),
      employees,
      worksites,
      flights: readFlightRows(),
    },
  };
}

function sendDataToTabulator() {
  if (
    !tabulatorWindow ||
    !employeeTableReady ||
    !flightLookupReady ||
    !farmTableReady ||
    initialDataSent
  ) {
    return;
  }

  const payload = buildEmployeeRequestPayload();
  if (!payload.data.Role && !roleReady) return;
  tabulatorWindow.postMessage(payload, TABULATOR_ORIGIN);
  initialDataSent = true;
  console.info("[LF bridge] unified init sent", {
    employees: payload.data.employees.length,
    worksites: payload.data.worksites.length,
    flights: payload.data.flights.length,
  });
}

function requestTextOrDefault(value, fallback) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function requestDateTime(value) {
  const source = value && typeof value === "object" ? value : null;
  const rawDate = source ? source.dateStr : value;
  const dateStr = String(rawDate ?? "")
    .split("T")[0]
    .trim();
  return {
    dateStr: dateStr || "1900-01-01",
    ...(dateStr && source?.timeStr ? { timeStr: String(source.timeStr) } : {}),
  };
}

async function appendEmployeeRequestsToOutputTable(requests) {
  if (requests.length === 0) return 0;

  const existingEmployeeNumbers = LFForm.getFieldValues({
    fieldId: FIELD_IDS.request.output.employeeNumber,
  });
  const firstIndex = Array.isArray(existingEmployeeNumbers)
    ? existingEmployeeNumbers.length
    : existingEmployeeNumbers == null || existingEmployeeNumbers === ""
      ? 0
      : 1;

  await LFForm.addRow(
    { fieldId: FIELD_IDS.request.outputTable },
    requests.length,
  );

  for (let offset = 0; offset < requests.length; offset++) {
    const request = requests[offset] ?? {};
    const index = firstIndex + offset;
    await LFForm.setFieldValues(
      { fieldId: FIELD_IDS.request.output.employeeNumber, index },
      String(request.Employee_Number ?? ""),
    );
    await LFForm.setFieldValues(
      { fieldId: FIELD_IDS.request.output.status, index },
      requestTextOrDefault(request.Request_Status, "Cancel"),
    );
    await LFForm.setFieldValues(
      { fieldId: FIELD_IDS.request.output.farm, index },
      requestTextOrDefault(request.Farm, "TBD"),
    );
    await LFForm.setFieldValues(
      { fieldId: FIELD_IDS.request.output.preferredArrival, index },
      requestDateTime(request.Preferred_Arrival_By),
    );
    await LFForm.setFieldValues(
      { fieldId: FIELD_IDS.request.output.flightNumber, index },
      requestTextOrDefault(request.Flight_Number, "TBD"),
    );
    await LFForm.setFieldValues(
      { fieldId: FIELD_IDS.request.output.carrier, index },
      String(request.Flight_Carrier ?? ""),
    );
    await LFForm.setFieldValues(
      { fieldId: FIELD_IDS.request.output.origin, index },
      String(request.Flight_Origin ?? ""),
    );
    await LFForm.setFieldValues(
      { fieldId: FIELD_IDS.request.output.destination, index },
      String(request.Flight_Destination ?? ""),
    );
    await LFForm.setFieldValues(
      { fieldId: FIELD_IDS.request.output.flightDateTime, index },
      requestDateTime(request.Flight_DateTime),
    );
    await LFForm.setFieldValues(
      { fieldId: FIELD_IDS.request.output.flightType, index },
      String(request.Flight_Type ?? ""),
    );
  }

  return requests.length;
}

window.addEventListener("message", (event) => {
  if (event.data?.type !== "employee-tabulator:ready") return;

  if (event.origin !== TABULATOR_ORIGIN || !event.source) {
    console.warn("[LF bridge] ignored ready message", {
      origin: event.origin,
      expectedOrigin: TABULATOR_ORIGIN,
      hasSource: Boolean(event.source),
    });
    return;
  }

  tabulatorWindow = event.source;
  console.info("[LF bridge] connected");
  sendDataToTabulator();

  if (helloTimer !== null) {
    clearInterval(helloTimer);
    helloTimer = null;
  }
});

window.addEventListener("message", async (event) => {
  if (
    event.origin !== TABULATOR_ORIGIN ||
    event.source !== tabulatorWindow ||
    event.data?.type !== "employee-request:save" ||
    !Array.isArray(event.data.requests)
  ) {
    return;
  }

  try {
    const rowsSaved = await appendEmployeeRequestsToOutputTable(
      event.data.requests,
    );
    console.info("[LF bridge] employee requests saved", { rowsSaved });
    event.source.postMessage(
      { type: "employee-request:saved", rowsSaved },
      TABULATOR_ORIGIN,
    );
  } catch (error) {
    console.error("[LF bridge] could not save employee requests", error);
    event.source.postMessage(
      {
        type: "employee-request:save-error",
        message: error instanceof Error ? error.message : String(error),
      },
      TABULATOR_ORIGIN,
    );
  }
});

function sendHelloToTabulatorFrames() {
  if (!helloScanLogged) {
    helloScanLogged = true;
    console.info("[LF bridge] sending hello to child frames", {
      frameCount: window.parent.frames.length,
    });
    if (window.parent.frames.length === 0) {
      console.warn("[LF bridge] no child frames found for handshake");
    }
  }

  for (let index = 0; index < window.parent.frames.length; index++) {
    try {
      window.parent.frames[index].postMessage(
        { type: "employee-tabulator:hello" },
        "*",
      );
    } catch (error) {
      console.debug("Could not send tabulator hello to frame", index, error);
    }
  }
}

sendHelloToTabulatorFrames();
helloTimer = setInterval(sendHelloToTabulatorFrames, 250);

LFForm.onFieldChange(
  () => {
    if (!employeeTableReady) {
      console.info("[LF bridge] employee table ready");
    }
    employeeTableReady = true;
    sendDataToTabulator();
  },
  { fieldId: FIELD_IDS.employeeTableReady },
);

LFForm.onFieldChange(
  () => {
    if (!flightLookupReady) {
      console.info("[LF bridge] flight lookup ready");
    }
    flightLookupReady = true;
    sendDataToTabulator();
  },
  { fieldId: FIELD_IDS.flight.type },
);

LFForm.onFieldChange(
  () => {
    if (!farmTableReady) {
      console.info("[LF bridge] farm table ready");
    }
    farmTableReady = true;
    sendDataToTabulator();
  },
  { fieldId: FIELD_IDS.request.farmTable },
);

LFForm.onFieldChange(
  () => {
    roleReady = true;
    sendDataToTabulator();
  },
  { fieldId: FIELD_IDS.request.role },
);

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
    request_status: 107,
    requested_arrival: 108,
    farm: 109,
  },
  request: {
    role: 110,
    farmTable: 112,
    outputTable: 71,
    output: {
      employeeNumber: 72,
      fullName: 73,
      status: 74,
      farm: 75,
      preferredArrival: 76,
      flightNumber: 77,
      carrier: 113,
      origin: 114,
      destination: 115,
      flightDateTime: 116,
      flightType: 117,
      phoneNumber: 118,
      email: 119,
      newHireName: 120,
    },
    flightStatus: 107,
    flightFarm: 109,
    requestedArrival: 108,
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

const TABULATOR_ORIGIN = "https://jealous-fruits.github.io";
const SUBMIT_STATUS_FIELD = Object.freeze({ variableName: "Submit_Status" });
const SAVE_SUMMARY_FIELD = Object.freeze({ fieldId: 122 });
let tabulatorWindow = null;
let helloTimer = null;
let employeeTableReady = false;
let flightLookupReady = false;
let farmTableReady = false;
let roleReady = false;
let initialDataSent = false;
let helloScanLogged = false;
let saveInProgress = false;
let submissionBlocked = false;
let pendingReviewRequests = [];

function isSubmitStatusTrue() {
  const fieldValue = LFForm.getFieldValues(SUBMIT_STATUS_FIELD);
  const value = Array.isArray(fieldValue) ? fieldValue[0] : fieldValue;
  if (value && typeof value === "object") {
    return String(value.data ?? value.value ?? value.label ?? "")
      .trim()
      .toLowerCase() === "true";
  }
  return value === true || String(value ?? "").trim().toLowerCase() === "true";
}

async function setSubmissionStatus(allowed) {
  const expectedValue = allowed ? "True" : "False";
  await LFForm.setFieldValues(SUBMIT_STATUS_FIELD, expectedValue);
  if (isSubmitStatusTrue() !== allowed) {
    throw new Error(`Submit_Status did not update to ${expectedValue}.`);
  }
}

LFForm.onFormSubmission(() => {
  try {
    if (!submissionBlocked && isSubmitStatusTrue()) return;
  } catch (error) {
    console.error("[LF bridge] could not verify submission status", error);
  }
  return {
    error: "Employee request data has not finished saving. Wait for the save to complete before submitting.",
  };
});

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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function summaryDateTime(value) {
  const source = value && typeof value === "object" ? value : null;
  const date = String(source?.dateStr ?? value ?? "").trim();
  const time = String(source?.timeStr ?? "").trim();
  return [date, time].filter(Boolean).join(" ");
}

function buildSaveSummary(requests) {
  const employeeSummaries = [];
  const specificNewHireSummaries = [];
  const anonymousNewHiresByFarm = new Map();

  for (const rawRequest of requests) {
    const request = rawRequest ?? {};
    const employeeNumber = String(request.Employee_Number ?? "").trim();
    const isNewHire = Number(employeeNumber) < 0;
    const name = String(request.FullName ?? "").trim();
    const phoneNumber = String(request.PhoneNumber ?? "").trim();
    const email = String(request.Email ?? "").trim();
    const farm = requestTextOrDefault(request.Farm, "Unspecified farm");

    if (isNewHire && !name && !phoneNumber && !email) {
      anonymousNewHiresByFarm.set(
        farm,
        (anonymousNewHiresByFarm.get(farm) ?? 0) + 1,
      );
      continue;
    }

    const details = [
      `Status: ${requestTextOrDefault(request.Request_Status, "Cancel")}`,
      `Farm: ${farm}`,
    ];

    if (isNewHire) {
      if (phoneNumber) details.push(`Phone: ${phoneNumber}`);
      if (email) details.push(`Email: ${email}`);
      specificNewHireSummaries.push(
        `<li><strong>${escapeHtml(name || "New hire (contact provided)")}</strong> — ${details
          .map(escapeHtml)
          .join("; ")}</li>`,
      );
      continue;
    }

    const preferredArrival = summaryDateTime(request.Preferred_Arrival_By);
    if (preferredArrival) {
      details.push(`Preferred arrival/departure: ${preferredArrival}`);
    }

    const flightDateTime = summaryDateTime(request.Flight_DateTime);
    const flightDetails = [
      `Number: ${requestTextOrDefault(request.Flight_Number, "TBD")}`,
      request.Flight_Carrier ? `Carrier: ${request.Flight_Carrier}` : "",
      request.Flight_Origin || request.Flight_Destination
        ? `Route: ${request.Flight_Origin || "?"} to ${request.Flight_Destination || "?"}`
        : "",
      flightDateTime ? `Date/time: ${flightDateTime}` : "",
      request.Flight_Type ? `Type: ${request.Flight_Type}` : "",
    ].filter(Boolean);
    details.push(`Flight: ${flightDetails.join("; ")}`);

    const employeeName = String(request.FullName ?? "").trim();
    employeeSummaries.push(
      `<li><strong>Employee #${escapeHtml(employeeNumber || "unknown")}${employeeName ? ` — ${escapeHtml(employeeName)}` : ""}</strong> — ${details
        .map(escapeHtml)
        .join("; ")}</li>`,
    );
  }

  const anonymousNewHireCount = [...anonymousNewHiresByFarm.values()]
    .reduce((total, count) => total + count, 0);
  const newHireCount = specificNewHireSummaries.length + anonymousNewHireCount;
  const anonymousNewHireSummaries = [...anonymousNewHiresByFarm.entries()]
    .map(([farm, count]) => {
      const hireLabel = count === 1 ? "new hire" : "new hires";
      return `<li>${count} ${hireLabel} requested for ${escapeHtml(farm)}</li>`;
    });
  const employeeSection = employeeSummaries.length
    ? `<h4>Employee requests</h4><ul>${employeeSummaries.join("")}</ul>`
    : "";
  const specificNewHireSection = specificNewHireSummaries.length
    ? `<h4>Specific New Worker Requests</h4><ul>${specificNewHireSummaries.join("")}</ul>`
    : "";
  const anonymousNewHireSection = anonymousNewHireSummaries.length
    ? `<h4>Unspecified New Worker Requests</h4><ul>${anonymousNewHireSummaries.join("")}</ul>`
    : "";

  return `<h3>Review pending changes</h3><p>${employeeSummaries.length} employee request(s) and ${newHireCount} new hire(s) are pending submission. Verify these details before submitting the form.</p>${employeeSection}${specificNewHireSection}${anonymousNewHireSection}`;
}

async function writeSaveSummary(content) {
  await LFForm.changeFieldSettings(SAVE_SUMMARY_FIELD, { content });
}

async function setOutputFieldValue(fieldName, fieldId, index, value) {
  try {
    await LFForm.setFieldValues({ fieldId, index }, value);
  } catch (error) {
    console.error("[LF bridge] failed to set output field", {
      fieldName,
      fieldId,
      index,
      rowNumber: index + 1,
      error,
    });
    throw error;
  }
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

  const fieldWrites = [];
  for (let offset = 0; offset < requests.length; offset++) {
    const request = requests[offset] ?? {};
    const index = firstIndex + offset;
    const newHireName = Number(request.Employee_Number) < 0
      ? String(request.FullName ?? "")
      : "";
    fieldWrites.push(
      setOutputFieldValue(
        "employeeNumber",
        FIELD_IDS.request.output.employeeNumber,
        index,
        String(request.Employee_Number ?? ""),
      ),
      setOutputFieldValue(
        "status",
        FIELD_IDS.request.output.status,
        index,
        requestTextOrDefault(request.Request_Status, "Cancel"),
      ),
      setOutputFieldValue(
        "farm",
        FIELD_IDS.request.output.farm,
        index,
        requestTextOrDefault(request.Farm, "TBD"),
      ),
      setOutputFieldValue(
        "preferredArrival",
        FIELD_IDS.request.output.preferredArrival,
        index,
        requestDateTime(request.Preferred_Arrival_By),
      ),
      setOutputFieldValue(
        "flightNumber",
        FIELD_IDS.request.output.flightNumber,
        index,
        requestTextOrDefault(request.Flight_Number, "TBD"),
      ),
      setOutputFieldValue(
        "carrier",
        FIELD_IDS.request.output.carrier,
        index,
        String(request.Flight_Carrier ?? ""),
      ),
      setOutputFieldValue(
        "origin",
        FIELD_IDS.request.output.origin,
        index,
        String(request.Flight_Origin ?? ""),
      ),
      setOutputFieldValue(
        "destination",
        FIELD_IDS.request.output.destination,
        index,
        String(request.Flight_Destination ?? ""),
      ),
      setOutputFieldValue(
        "flightDateTime",
        FIELD_IDS.request.output.flightDateTime,
        index,
        requestDateTime(request.Flight_DateTime),
      ),
      setOutputFieldValue(
        "flightType",
        FIELD_IDS.request.output.flightType,
        index,
        String(request.Flight_Type ?? ""),
      ),
      setOutputFieldValue(
        "phoneNumber",
        FIELD_IDS.request.output.phoneNumber,
        index,
        String(request.PhoneNumber ?? ""),
      ),
      setOutputFieldValue(
        "email",
        FIELD_IDS.request.output.email,
        index,
        String(request.Email ?? ""),
      ),
      setOutputFieldValue(
        "newHireName",
        FIELD_IDS.request.output.newHireName,
        index,
        newHireName,
      ),
    );
  }

  const writeResults = await Promise.allSettled(fieldWrites);
  const failedWrite = writeResults.find(
    (result) => result.status === "rejected",
  );
  if (failedWrite) throw failedWrite.reason;

  return requests.length;
}

async function removeTemporaryWorkerRows(employeeNumbers) {
  const requestedNumbers = [...new Set(
    employeeNumbers.map((value) => String(value).trim()),
  )];
  if (requestedNumbers.some(
    (value) => !value || !Number.isFinite(Number(value)) || Number(value) >= 0,
  )) {
    throw new Error("Temporary worker removals require negative employee numbers.");
  }

  const outputNumbers = LFForm.getFieldValues({
    fieldId: FIELD_IDS.request.output.employeeNumber,
  });
  const outputRows = Array.isArray(outputNumbers)
    ? outputNumbers
    : outputNumbers == null || outputNumbers === ""
      ? []
      : [outputNumbers];
  const requestedSet = new Set(requestedNumbers);
  const matchingIndices = outputRows
    .map((value, index) => ({ value: String(value ?? "").trim(), index }))
    .filter((entry) => requestedSet.has(entry.value));
  const foundNumbers = new Set(matchingIndices.map((entry) => entry.value));
  const missingNumbers = requestedNumbers.filter((value) => !foundNumbers.has(value));
  if (missingNumbers.length) {
    throw new Error(`Could not find saved worker row(s): ${missingNumbers.join(", ")}.`);
  }

  const indicesToDelete = matchingIndices
    .map((entry) => entry.index)
    .sort((left, right) => right - left);
  for (const index of indicesToDelete) {
    await LFForm.deleteRow(
      { fieldId: FIELD_IDS.request.outputTable },
      index,
    );
  }

  pendingReviewRequests = pendingReviewRequests.filter(
    (request) => !requestedSet.has(String(request.Employee_Number ?? "").trim()),
  );
  return requestedNumbers.length;
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
  const isSaveRequest = event.data?.type === "employee-request:save" &&
    Array.isArray(event.data.requests);
  const isWorkerRemoval = event.data?.type ===
    "employee-request:remove-temporary-workers" &&
    Array.isArray(event.data.employeeNumbers);
  if (
    event.origin !== TABULATOR_ORIGIN ||
    !event.source ||
    event.source !== tabulatorWindow ||
    (!isSaveRequest && !isWorkerRemoval)
  ) {
    return;
  }

  if (saveInProgress) {
    event.source.postMessage(
      {
        type: "employee-request:save-error",
        message: "An employee request save is already in progress.",
      },
      TABULATOR_ORIGIN,
    );
    return;
  }

  saveInProgress = true;
  submissionBlocked = true;

  try {
    await writeSaveSummary(
      isWorkerRemoval
        ? "<p>Removing saved worker request. Please wait...</p>"
        : "<p>Saving employee request changes. Please wait...</p>",
    );
    await setSubmissionStatus(false);
    if (isWorkerRemoval) {
      const removedCount = await removeTemporaryWorkerRows(
        event.data.employeeNumbers,
      );
      await writeSaveSummary(buildSaveSummary(pendingReviewRequests));
      await setSubmissionStatus(true);
      submissionBlocked = false;
      event.source.postMessage(
        { type: "employee-request:workers-removed", removedCount },
        TABULATOR_ORIGIN,
      );
      return;
    }

    const requestsToSave = event.data.requests.map((request) =>
      request && typeof request === "object" ? { ...request } : {},
    );
    const rowsSaved = await appendEmployeeRequestsToOutputTable(requestsToSave);
    pendingReviewRequests = pendingReviewRequests.concat(requestsToSave);
    await writeSaveSummary(buildSaveSummary(pendingReviewRequests));
    await setSubmissionStatus(true);
    submissionBlocked = false;
    console.info("[LF bridge] employee requests saved", { rowsSaved });
    event.source.postMessage(
      { type: "employee-request:saved", rowsSaved },
      TABULATOR_ORIGIN,
    );
  } catch (error) {
    console.error("[LF bridge] could not save employee requests", error);
    try {
      await writeSaveSummary(
        `<h3>Save incomplete</h3><p>The latest changes could not be saved completely. Do not submit the form until the save succeeds.</p>${pendingReviewRequests.length ? buildSaveSummary(pendingReviewRequests) : ""}`,
      );
    } catch (summaryError) {
      console.error("[LF bridge] could not update save summary", summaryError);
    }
    event.source.postMessage(
      {
        type: "employee-request:save-error",
        message: error instanceof Error ? error.message : String(error),
      },
      TABULATOR_ORIGIN,
    );
  } finally {
    saveInProgress = false;
  }
});

const helloStartedAt = Date.now();

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
        TABULATOR_ORIGIN,
      );
    } catch (error) {
      console.debug("Could not send tabulator hello to frame", index, error);
    }
  }
}

sendHelloToTabulatorFrames();
helloTimer = setInterval(() => {
  if (Date.now() - helloStartedAt >= 60000) {
    clearInterval(helloTimer);
    helloTimer = null;
    console.warn(
      `[LF bridge] no response from ${TABULATOR_ORIGIN} after 60 seconds; check the embedded iframe URL`,
    );
    return;
  }
  sendHelloToTabulatorFrames();
}, 1000);

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

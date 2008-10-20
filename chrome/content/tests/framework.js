const abp = {
  getString: function(name)
  {
    return name;
  },
  getInstalledVersion: function()
  {
    return "1.5";
  },
  getLineBreak: function()
  {
    return "\r\n";
  },
  versionComparator: Components.classes["@mozilla.org/xpcom/version-comparator;1"]
                               .createInstance(Components.interfaces.nsIVersionComparator)
};
const ioService = Components.classes["@mozilla.org/network/io-service;1"]
                            .getService(Components.interfaces.nsIIOService);

var resultTable = null;

var totalPassed = 0;
var totalFailed = 0;
var totalPassedCell = null;
var totalFailedCell = null;

var geckoVersion = 0;
try {
  geckoVersion = Components.classes["@mozilla.org/xre/app-info;1"]
                           .getService(Components.interfaces.nsIXULAppInfo)
                           .platformVersion;
} catch (e) {}

function writeResult(test, result, expected)
{
  let row = resultTable.insertRow(-1);

  let testCell = row.insertCell(-1);
  testCell.textContent = test;

  let resultCell = row.insertCell(-1);
  resultCell.textContent = result;
  resultCell.style.whiteSpace = "pre-wrap";

  let expectedCell = row.insertCell(-1);
  expectedCell.textContent = expected;
  expectedCell.style.whiteSpace = "pre-wrap";

  row.style.backgroundColor = (result == expected ? "#80FF80" : "#FF8080");
  if (result == expected)
    totalPassedCell.textContent = ++totalPassed;
  else
    totalFailedCell.textContent = ++totalFailed;
}

window.onload = start;

function start()
{
  let summaryTable = document.createElement("table");
  summaryTable.setAttribute("border", "1");
  summaryTable.setAttribute("cellpadding", "5");
  summaryTable.style.marginBottom = "20px";

  let row = summaryTable.insertRow(-1);
  let cell = row.insertCell(-1);
  cell.textContent = "Passed";
  totalPassedCell = row.insertCell(-1);
  totalPassedCell.id = "passed";
  totalPassedCell.textContent = totalPassed;

  row = summaryTable.insertRow(-1);
  cell = row.insertCell(-1);
  cell.textContent = "Failed";
  totalFailedCell = row.insertCell(-1);
  totalFailedCell.id = "failed";
  totalFailedCell.textContent = totalFailed;

  document.body.appendChild(summaryTable);

  resultTable = document.createElement("table");
  resultTable.setAttribute("border", "1");

  row = resultTable.insertRow(-1);
  for each (let title in ["Test", "Actual result", "Expected"])
  {
    let header = document.createElement("th");
    header.textContent = title;
    row.appendChild(header);
  }
  document.body.appendChild(resultTable);

  try {
    tests();
  }
  catch (e) {
    writeResult("exceptions", e + "\n" + e.stack, "no exception");
    throw e;
  }
}

function compareGeckoVersion(version)
{
  return Components.classes["@mozilla.org/xpcom/version-comparator;1"]
                   .createInstance(Components.interfaces.nsIVersionComparator)
                   .compare(geckoVersion, version);
}
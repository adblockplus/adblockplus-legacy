var abp = {
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

var geckoVersion = 0;
try {
  geckoVersion = Components.classes["@mozilla.org/xre/app-info;1"]
                           .getService(Components.interfaces.nsIXULAppInfo)
                           .platformVersion;
} catch (e) {}

function compareGeckoVersion(version)
{
  return Components.classes["@mozilla.org/xpcom/version-comparator;1"]
                   .createInstance(Components.interfaces.nsIVersionComparator)
                   .compare(geckoVersion, version);
}

function showProfilingData(debuggerService)
{
  let scripts = [];
  debuggerService.enumerateScripts({
    enumerateScript: function(script)
    {
      scripts.push(script);
    }
  });
  scripts = scripts.filter(function(script)
  {
    return script.fileName.indexOf("chrome://adblockplus/") == 0 && script.callCount > 0;
  });
  scripts.sort(function(a, b)
  {
    return b.totalOwnExecutionTime - a.totalOwnExecutionTime;
  });

  let table = document.createElement("table");
  table.setAttribute("border", "border");

  let header = table.insertRow(-1);
  header.style.fontWeight = "bold";
  header.insertCell(-1).textContent = "Function name";
  header.insertCell(-1).textContent = "Call count";
  header.insertCell(-1).textContent = "Min execution time (total/own)";
  header.insertCell(-1).textContent = "Max execution time (total/own)";
  header.insertCell(-1).textContent = "Total execution time (total/own)";

  for each (let script in scripts)
    showProfilingDataForScript(script, table);

  document.getElementById("display").appendChild(table);
}

function showProfilingDataForScript(script, table)
{
  let functionName = script.functionName;
  if (functionName == "anonymous")
    functionName = guessFunctionName(script.fileName, script.baseLineNumber);

  let row = table.insertRow(-1);
  row.insertCell(-1).innerHTML = functionName + "<br/>\n" + script.fileName.replace("chrome://adblockplus/", "") + ":" + script.baseLineNumber;
  row.insertCell(-1).textContent = script.callCount;
  row.insertCell(-1).textContent = script.minExecutionTime.toFixed(2) + "/" + script.minOwnExecutionTime.toFixed(2);
  row.insertCell(-1).textContent = script.maxExecutionTime.toFixed(2) + "/" + script.maxOwnExecutionTime.toFixed(2);
  row.insertCell(-1).textContent = script.totalExecutionTime.toFixed(2) + "/" + script.totalOwnExecutionTime.toFixed(2);
}

let fileCache = {};
function guessFunctionName(fileName, lineNumber)
{
  if (!(fileName in fileCache))
  {
    try
    {
      let request = new XMLHttpRequest();
      request.open("GET", fileName, false);
      request.overrideMimeType("text/plain");
      request.send(null);
      fileCache[fileName] = request.responseText.split(/\n/);
    }
    catch (e)
    {
      return "anonymous";
    }
  }

  let data = fileCache[fileName];

  lineNumber--;
  if (lineNumber >= 0 && lineNumber < data.length && /(\w+)\s*[:=]\s*function/.test(data[lineNumber]))
    return RegExp.$1;

  lineNumber--;
  if (lineNumber >= 0 && lineNumber < data.length && /(\w+)\s*[:=]\s*function/.test(data[lineNumber]))
    return RegExp.$1;

  return "anonymous";
}

if (/[?&]profiler/i.test(location.href))
{
  let debuggerService = Components.classes["@mozilla.org/js/jsd/debugger-service;1"]
                                  .getService(Components.interfaces.jsdIDebuggerService);

  let oldFinish = SimpleTest.finish;
  SimpleTest.finish = function()
  {
    showProfilingData(debuggerService);
    debuggerService.off();
    return oldFinish.apply(this, arguments);
  }
  window.addEventListener("unload", function()
  {
    debuggerService.off();
  }, true);
  debuggerService.on();
  debuggerService.flags |= debuggerService.COLLECT_PROFILE_DATA;
  debuggerService.clearProfileData();
}

// Stub for a function that's used for profiling startup
var timeLine = {log: function() {}};

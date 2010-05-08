if (typeof Cc == "undefined")
  eval("const Cc = Components.classes");
if (typeof Ci == "undefined")
  eval("const Ci = Components.interfaces");
if (typeof Cr == "undefined")
  eval("const Cr = Components.results");
if (typeof Cu == "undefined")
  eval("const Cu = Components.utils");

let baseURL = Cc["@adblockplus.org/abp/private;1"].getService(Ci.nsIURI);

var geckoVersion = Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULAppInfo).platformVersion;
function compareGeckoVersion(version)
{
  Cu.import(baseURL.spec + "Utils.jsm");
  return Utils.versionComparator.compare(geckoVersion, version);
}

function getGlobalForObject(obj)
{
  if ("getGlobalForObject" in Cu)
    return Cu.getGlobalForObject(obj);  // Gecko 1.9.3 and higher
  else
    return obj.__parent__;              // Gecko 1.9.0/1.9.1/1.9.2
}

function prepareFilterComponents(keepObservers)
{
  Cu.import(baseURL.spec + "FilterClasses.jsm");
  Cu.import(baseURL.spec + "SubscriptionClasses.jsm");
  Cu.import(baseURL.spec + "FilterStorage.jsm");
  Cu.import(baseURL.spec + "Matcher.jsm");
  Cu.import(baseURL.spec + "ElemHide.jsm");
  Cu.import(baseURL.spec + "FilterListener.jsm");

  let FilterStorageGlobal = getGlobalForObject(FilterStorage);
  let oldSubscriptions = FilterStorage.subscriptions;
  let oldStorageKnown = FilterStorage.knownSubscriptions;
  let oldSubscriptionsKnown = Subscription.knownSubscriptions;
  let oldFiltersKnown = Subscription.knownSubscriptions;
  let oldSubscriptionObservers = FilterStorageGlobal.subscriptionObservers;
  let oldFilterObservers = FilterStorageGlobal.filterObservers;
  let oldSourceFile = FilterStorageGlobal.sourceFile;

  FilterStorage.subscriptions = [];
  FilterStorage.knownSubscriptions = {__proto__: null};
  Subscription.knownSubscriptions = {__proto__: null};
  Filter.knownFilters = {__proto__: null};
  if (!keepObservers)
  {
    FilterStorageGlobal.subscriptionObservers = [];
    FilterStorageGlobal.filterObservers = [];
    FilterStorageGlobal.sourceFile = null;
  }

  blacklistMatcher.clear();
  whitelistMatcher.clear();
  ElemHide.clear();

  window.addEventListener("unload", function()
  {
    FilterStorage.subscriptions = oldSubscriptions;
    FilterStorage.knownSubscriptions = oldStorageKnown;
    Subscription.knownSubscriptions = oldSubscriptionsKnown;
    Subscription.knownSubscriptions = oldFiltersKnown;
    FilterStorageGlobal.subscriptionObservers = oldSubscriptionObservers;
    FilterStorageGlobal.filterObservers = oldFilterObservers;
    FilterStorageGlobal.sourceFile = oldSourceFile;

    FilterStorage.triggerSubscriptionObservers("reload", FilterStorage.subscriptions);
  }, false);
}

function preparePrefs()
{
  Cu.import(baseURL.spec + "Prefs.jsm");

  let backup = {__proto__: null};
  for (let pref in Prefs)
  {
    if (Prefs.getDefault(pref) !== null)
      backup[pref] = Prefs[pref];
  }
  Prefs.enabled = true;

  window.addEventListener("unload", function()
  {
    for (let pref in backup)
      Prefs[pref] = backup[pref];
    Prefs.save();
  }, false);
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
  let debuggerService = Cc["@mozilla.org/js/jsd/debugger-service;1"].getService(Ci.jsdIDebuggerService);

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

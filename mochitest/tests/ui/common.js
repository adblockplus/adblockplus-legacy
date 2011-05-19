var geckoVersion = Components.classes["@mozilla.org/xre/app-info;1"]
                             .getService(Components.interfaces.nsIXULAppInfo)
                             .platformVersion;
function compareGeckoVersion(version)
{
  return Components.classes["@mozilla.org/xpcom/version-comparator;1"]
                   .createInstance(Components.interfaces.nsIVersionComparator)
                   .compare(geckoVersion, version);
}

function getBrowserWindow()
{
  return window.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
               .getInterface(Components.interfaces.nsIWebNavigation)
               .QueryInterface(Components.interfaces.nsIDocShellTreeItem)
               .rootTreeItem
               .QueryInterface(Components.interfaces.nsIInterfaceRequestor)
               .getInterface(Components.interfaces.nsIDOMWindow);
}

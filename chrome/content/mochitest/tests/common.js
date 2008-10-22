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
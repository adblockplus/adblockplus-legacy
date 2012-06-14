/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

function init()
{
  let {AddonManager} = Cu.import("resource://gre/modules/AddonManager.jsm", null);
  let {addonID} = require("info");
  AddonManager.getAddonByID(addonID, function(addon)
  {
    loadInstallManifest(addon.getResourceURI("install.rdf"), addon.name, addon.homepageURL);
  });
}

function loadInstallManifest(installManifestURI, name, homepage)
{
  let rdf = Cc["@mozilla.org/rdf/rdf-service;1"].getService(Ci.nsIRDFService);
  let ds = rdf.GetDataSource(installManifestURI.spec);
  let root = rdf.GetResource("urn:mozilla:install-manifest");

  function emResource(prop)
  {
    return rdf.GetResource("http://www.mozilla.org/2004/em-rdf#" + prop);
  }

  function getTargets(prop)
  {
    let targets = ds.GetTargets(root, emResource(prop), true);
    let result = [];
    while (targets.hasMoreElements())
      result.push(targets.getNext().QueryInterface(Ci.nsIRDFLiteral).Value);
    return result;
  }

  function dataSourceLoaded()
  {
    setExtensionData(name, getTargets("version")[0],
                     homepage, getTargets("creator"),
                     getTargets("contributor"), getTargets("translator"));
  }

  if (ds instanceof Ci.nsIRDFRemoteDataSource && ds.loaded)
    dataSourceLoaded();
  else
  {
    let sink = ds.QueryInterface(Ci.nsIRDFXMLSink);
    sink.addXMLSinkObserver({
      onBeginLoad: function() {},
      onInterrupt: function() {},
      onResume: function() {},
      onEndLoad: function() {
        sink.removeXMLSinkObserver(this);
        dataSourceLoaded();
      },
      onError: function() {},
    });
  }
}

function cmpNoCase(a, b)
{
  let aLC = a.toLowerCase();
  let bLC = b.toLowerCase();
  if (aLC < bLC)
    return -1;
  else if (aLC > bLC)
    return 1;
  else
    return 0;
}

function setExtensionData(name, version, homepage, authors, contributors, translators)
{
  authors.sort(cmpNoCase);
  contributors.sort(cmpNoCase);
  translators.sort(cmpNoCase);

  E("title").value = name;
  E("version").value = version;
  E("homepage").value = homepage;
  E("authors").textContent = authors.join(", ");
  E("contributors").textContent = contributors.join(", ");
  E("translators").textContent = translators.join(", ");

  let request = new XMLHttpRequest();
  request.open("GET", "chrome://adblockplus/content/ui/subscriptions.xml");
  request.addEventListener("load", setSubscriptionAuthors, false);
  request.send(null);
}

function setSubscriptionAuthors()
{
  let doc = this.responseXML;
  if (!doc || doc.documentElement.localName != "subscriptions")
    return;

  let authors = {__proto__: null};
  for (let node = doc.documentElement.firstChild; node; node = node.nextSibling)
  {
    if (node.localName != "subscription" || !node.hasAttribute("author"))
      continue;

    for each (let author in node.getAttribute("author").split(","))
    {
      author = author.replace(/^\s+/, "").replace(/\s+$/, "");
      if (author == "")
        continue;

      authors[author] = true;
    }
  }

  let list = [];
  for (let author in authors)
    list.push(author);

  list.sort(cmpNoCase)
  E("subscriptionAuthors").textContent = list.join(", ");

  E("mainBox").setAttribute("loaded", "true");
}

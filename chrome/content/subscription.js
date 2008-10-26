/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Adblock Plus.
 *
 * The Initial Developer of the Original Code is
 * Wladimir Palant.
 * Portions created by the Initial Developer are Copyright (C) 2006-2008
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

var abp = Components.classes["@mozilla.org/adblockplus;1"].createInstance().wrappedJSObject;
var prefs = abp.prefs;

var subscription = null;
var result = null;
var autoAdd = false;

function init() {
  if (window.arguments)
  {
    // In K-Meleon we might get the arguments wrapped
    for (var i = 0; i < window.arguments.length; i++)
      if (window.arguments[i] && "wrappedJSObject" in window.arguments[i])
        window.arguments[i] = window.arguments[i].wrappedJSObject;

    [subscription, result] = window.arguments;
  }

  autoAdd = !result;
  if (!result)
    result = {};

  if (subscription)
  {
    document.getElementById("location").value = subscription.url;
    document.getElementById("title").value = subscription.title;
  }
  else
    document.getElementById("title").value = "";

  if (subscription instanceof abp.Subscription)
  {
    document.getElementById("enabled").setAttribute("checked", !subscription.disabled);
    if (subscription instanceof abp.ExternalSubscription)
    {
      document.getElementById("location").setAttribute("disabled", "true");
      document.getElementById("external-description").hidden = false;
      document.getElementById("autodownload").setAttribute("checked", "true");
      document.getElementById("autodownload").setAttribute("disabled", "true");
    }
    else
    {
      document.getElementById("edit-description").hidden = false;
      document.getElementById("autodownload").setAttribute("checked", subscription.autoDownload);
    }
  }
  else
  {
    document.title = document.documentElement.getAttribute("newtitle");
    document.getElementById("new-description").hidden = false;
    document.getElementById("enabled").setAttribute("checked", "true");
    document.getElementById("autodownload").setAttribute("checked", "true");
  }
}

function saveSubscription()
{
  var add = !(subscription instanceof abp.Subscription);
  var url = (add || subscription instanceof abp.DownloadableSubscription ? document.getElementById("location").value.replace(/^\s+/, "").replace(/\s+$/, "").replace(/^~+/, "") : subscription.url);
  if (!url)
  {
    alert(abp.getString("subscription_no_location"));
    document.getElementById("location").focus();
    return false;
  }

  if (add || subscription.url != url)
  {
    var file = Components.classes["@mozilla.org/file/local;1"]
                          .createInstance(Components.interfaces.nsILocalFile);
    try {
      file.initWithPath(url);
      var ioService = Components.classes["@mozilla.org/network/io-service;1"]
                                .getService(Components.interfaces.nsIIOService); 
      var protHandler = ioService.getProtocolHandler('file')
                                .QueryInterface(Components.interfaces.nsIFileProtocolHandler);
      url = protHandler.newFileURI(file).spec;
    } catch (e2) {
      try {
        var uri = Components.classes["@mozilla.org/network/simple-uri;1"]
                            .createInstance(Components.interfaces.nsIURI);
        uri.spec = url;
        url = uri.spec;
      } catch (e) {
        alert(abp.getString("subscription_invalid_location"));
        document.getElementById("location").focus();
        return false;
      }
    }
  }

  result.url = url;
  result.title = document.getElementById("title").value.replace(/^\s+/, "").replace(/\s+$/, "");
  if (!result.title)
    result.title = result.url;

  result.autoDownload = document.getElementById("autodownload").checked;
  result.disabled = !document.getElementById("enabled").checked;

  if (autoAdd)
    abp.addSubscription(result.url, result.title, result.autoDownload, result.disabled);

  return true;
}

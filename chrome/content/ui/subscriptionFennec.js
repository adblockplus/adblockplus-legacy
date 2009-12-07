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
 * Portions created by the Initial Developer are Copyright (C) 2006-2009
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

const Cc = Components.classes;
const Ci = Components.interfaces;

var subscription = null;
var result = null;
var autoAdd = false;
var abp = Components.classes["@mozilla.org/adblockplus;1"].createInstance().wrappedJSObject;

// Copied from Fennec's PromptService.js
// add a width style to prevent a element to grow larger 
// than the screen width
function sizeElement(id, percent)
{
  let elem = document.getElementById(id);
  let screenW = document.getElementById("main-window").getBoundingClientRect().width;
  elem.style.width = screenW * percent / 100 + "px"
}

// size the height of the scrollable message. this assumes the given element
// is a child of a scrollbox
function sizeScrollableMsg(id, percent)
{
  let doc = document;
  let screenH = doc.getElementById("main-window").getBoundingClientRect().height;
  let maxHeight = screenH * percent / 100;
  
  let elem = doc.getElementById(id);
  let style = doc.defaultView.getComputedStyle(elem, null);
  let height = Math.ceil(elem.getBoundingClientRect().height) +
               parseInt(style.marginTop) +
               parseInt(style.marginBottom);

  if (height > maxHeight)
    height = maxHeight;
  elem.parentNode.style.height = height + "px";
}
  
function init()
{
  subscription = this.arguments;
  
  autoAdd = !result;
  if (!result)
    result = {};
  
  if (subscription)
  {
    sizeElement("abp-location", 50);
    document.getElementById("abp-location").appendChild(document.createTextNode(subscription.url));
    sizeScrollableMsg("abp-location", 50);
    document.getElementById("abp-title").value = subscription.title;
  }
  else
    document.getElementById("abp-title").value = "";
}

function saveSubscription()
{
  var add = !(subscription instanceof abp.Subscription);
  var url = (add || subscription instanceof abp.DownloadableSubscription ? document.getElementById("abp-location").firstChild.nodeValue.replace(/^\s+/, "").replace(/\s+$/, "").replace(/^~+/, "") : subscription.url);
  if (!url)
  {
    alert(abp.getString("subscription_no_location"));
    document.getElementById("abp-location").focus();
    return;
  }

  if (add || subscription.url != url)
  {
    var file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsILocalFile);
    try {
      file.initWithPath(url);
      var ioService = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService); 
      url = ioService.newFileURI(file).spec;
    } catch (e2) {
      try {
        var uri = Cc["@mozilla.org/network/simple-uri;1"].createInstance(Ci.nsIURI);
        uri.spec = url;
        url = uri.spec;
      } catch (e) {
        alert(abp.getString("subscription_invalid_location"));
        document.getElementById("abp-location").focus();
        return;
      }
    }
  }

  result.url = url;
  result.title = document.getElementById("abp-title").value.replace(/^\s+/, "").replace(/\s+$/, "");
  if (!result.title)
    result.title = result.url;

  result.autoDownload = true;
  result.disabled = false;
  
  let filterStorage = abp.filterStorage;
  let currentSubscription = filterStorage.subscriptions.filter(function(subscription) subscription instanceof abp.DownloadableSubscription);
  currentSubscription = (currentSubscription.length ? currentSubscription[0] : null);
  
    
  if (autoAdd) {
    dump("-- autoAdd is true\n");
    // We only allow one subscription, remove existing one before adding
    if (currentSubscription)
      filterStorage.removeSubscription(currentSubscription);
    abp.addSubscription(result.url, result.title, result.autoDownload, result.disabled);
  }
  
  this.close();
}

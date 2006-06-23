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
 * Portions created by the Initial Developer are Copyright (C) 2006
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

var abp = Components.classes["@mozilla.org/adblockplus;1"].createInstance();
while (abp && !("getString" in abp))
  abp = abp.wrappedJSObject;    // Unwrap component

var prefs = abp.prefs;

function addSubscriptions() {
  var added = false;
  var checkboxes = document.getElementsByTagName("checkbox");
  for (var i = 0; i < checkboxes.length; i++) {
    if (checkboxes[i].checked) {
      var title = checkboxes[i].getAttribute("_title");
      var url = checkboxes[i].getAttribute("_url");
      var disabled = (checkboxes[i].hasAttribute("_disabled") ? checkboxes[i].getAttribute("_disabled") == "true" : false);
      var autoDownload = (checkboxes[i].hasAttribute("_autoDownload") ? checkboxes[i].getAttribute("_autoDownload") == "true" : true);

      var subscription = (prefs.knownSubscriptions.has(url) ? prefs.knownSubscriptions.get(url) : prefs.subscriptionFromURL(url));
      if (!subscription)
        continue;
  
      var found = false;
      for (var j = 0; j < prefs.subscriptions.length; j++)
        if (prefs.subscriptions[j] == subscription)
          found = true;
  
      if (found)
        continue;
  
      subscription.title = title;
      subscription.disabled = disabled;
      subscription.autoDownload = autoDownload;
      prefs.subscriptions.push(subscription);
  
      abp.synchronizer.notifyListeners(subscription, "add");
      abp.synchronizer.execute(subscription);
  
      added = true;
    }
  }
  if (added)
    prefs.savePatterns();
}

function addOther() {
  var result = {};
  openDialog("subscription.xul", "_blank", "chrome,centerscreen,modal", abp, prefs, null, result);

  if (!("url" in result))
    return;

  var template = document.getElementsByTagName("template")[0];
  var container = template.firstChild.cloneNode(true);
  container.className = "containerAdded"

  var descriptions = container.getElementsByTagName("description");
  var remove = null;
  for (var i = 0; i < descriptions.length; i++) {
    if (descriptions[i].className == "title")
      descriptions[i].setAttribute("value", result.title);
    else if (descriptions[i].className == "homepage")
      remove = descriptions[i];
    else if (descriptions[i].className == "location")
      descriptions[i].setAttribute("value", result.url);
  }
  if (remove)
    remove.parentNode.removeChild(remove);

  var checkbox = container.getElementsByTagName("checkbox")[0];
  checkbox.setAttribute("_title", result.title);
  checkbox.setAttribute("_url", result.url);
  checkbox.setAttribute("_disabled", result.disabled);
  checkbox.setAttribute("_autoDownload", result.autoDownload);
  checkbox.checked = true;

  template.parentNode.height = template.parentNode.boxObject.height;
  template.parentNode.insertBefore(container, template);
}

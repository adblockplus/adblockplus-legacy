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

let abp = Components.classes["@mozilla.org/adblockplus;1"].createInstance().wrappedJSObject;
let prefs = abp.prefs;

let autoAdd;
let result;

let filtersetG = "filtersetg@updater";

function init()
{
  autoAdd = !(window.arguments && window.arguments.length);
  result = (autoAdd ? {disabled: false, external: false, autoDownload: true} : window.arguments[0]);
  document.getElementById("description-par1").hidden = !autoAdd;

  // Don't show Filterset.G warning in SeaMonkey - no point showing a warning
  // if we cannot uninstall updater.
  if ("@mozilla.org/extensions/manager;1" in Components.classes)
  {
    if ("Filterset.G" in abp.filterStorage.knownSubscriptions &&
        !abp.filterStorage.knownSubscriptions["Filterset.G"].disabled)
    {
      document.getElementById("filtersetg-warning").hidden = false;
    }

    let extensionManager = Components.classes["@mozilla.org/extensions/manager;1"]
                                     .getService(Components.interfaces.nsIExtensionManager);
    if (extensionManager.getItemForID(filtersetG) && !abp.denyFiltersetG)
      document.getElementById("filtersetg-warning").hidden = false;
  }  
}

function addSubscriptions() {
  var group = document.getElementById("subscriptions");
  var selected = group.selectedItem;
  if (!selected)
    return;

  result.url = selected.getAttribute("_url");
  result.title = selected.getAttribute("_title");
  result.autoDownload = true;
  result.disabled = false;

  if (autoAdd)
    abp.addSubscription(result.url, result.title, result.autoDownload, result.disabled);
}

function addOther() {
  openDialog("subscription.xul", "_blank", "chrome,centerscreen,modal", null, result);
  if ("url" in result)
  {
    if (autoAdd)
      abp.addSubscription(result.url, result.title, result.autoDownload, result.disabled);
    window.close();
  }
}

function handleKeyPress(e) {
  switch (e.keyCode) {
    case e.DOM_VK_PAGE_UP:
    case e.DOM_VK_PAGE_DOWN:
    case e.DOM_VK_END:
    case e.DOM_VK_HOME:
    case e.DOM_VK_LEFT:
    case e.DOM_VK_RIGHT:
    case e.DOM_VK_UP:
    case e.DOM_VK_DOWN:
      return false;
  }
  return true;
}

function uninstallFiltersetG()
{
  // Disable further updates
  abp.denyFiltersetG = true;

  // Uninstall extension
  let extensionManager = Components.classes["@mozilla.org/extensions/manager;1"]
                                   .getService(Components.interfaces.nsIExtensionManager);
  if (extensionManager.getItemForID(filtersetG))
  {
    let location = extensionManager.getInstallLocation(filtersetG);
    if (location && !location.canAccess)
    {
      // Cannot uninstall, need to disable
      extensionManager.disableItem(filtersetG);
    }
    else
    {
      extensionManager.uninstallItem(filtersetG);
    }
  }

  // Remove filter subscription
  if ("Filterset.G" in abp.filterStorage.knownSubscriptions)
    abp.filterStorage.removeSubscription(abp.filterStorage.knownSubscriptions["Filterset.G"]);

  document.getElementById("filtersetg-warning").hidden = true;
}

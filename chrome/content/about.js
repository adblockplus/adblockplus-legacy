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

const ADBLOCK_EXTENSION_ID = "{d10d0bf8-f5b5-c8b4-a8b2-2b9879e08c5d}"; 
const ADBLOCK_PACKAGE = "/adblockplus.mozdev.org"; 

var abp = Components.classes["@mozilla.org/adblockplus;1"].getService();
while (abp && !("getPrefs" in abp))
  abp = abp.wrappedJSObject;    // Unwrap component

function fillInVersion() {
  var versionField = document.getElementById("version");
  var version = getInstalledVersion();
  if (version)
    versionField.setAttribute("value", versionField.getAttribute("value") + " " + version);
  else
    versionField.parentNode.removeChild(versionField);
}

function getInstalledVersion() {
  var version = null;

  // Try Firefox Extension Manager
  try
  {
    var item = getUpdateItem()
    if (item)
      version = item.version;
  } catch (e) {}

  if (!version)
  {
    // Try InstallTrigger
    try
    {
      version = InstallTrigger.getVersion(ADBLOCK_PACKAGE);
    } catch (e) {}
  }

  return version;
}

function getUpdateItem() {
  var extensionManager = Components.classes["@mozilla.org/extensions/manager;1"]
                                   .getService(Components.interfaces.nsIExtensionManager);

  // FF 1.1+
  if ('getItemForID' in extensionManager)
    return extensionManager.getItemForID(ADBLOCK_EXTENSION_ID);

  // FF 1.0
  var itemList = extensionManager.getItemList(ADBLOCK_EXTENSION_ID, Components.interfaces.nsIUpdateItem.TYPE_EXTENSION, {});
  if (itemList && itemList.length > 0)
    return itemList[0];

  return null;
}

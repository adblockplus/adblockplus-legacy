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

var adblockp = null;
try {
  adblockp = Components.classes["@mozilla.org/adblockplus;1"]
                      .getService(Components.interfaces.nsISupports);
  while (adblockp && !('getPrefs' in adblockp))
    adblockp = adblockp.wrappedJSObject;    // Unwrap Adblock Plus component
} catch (e) {}

var adblockpPrefs = adblockp ? adblockp.getPrefs() : {enabled: false};

// With older Mozilla versions load event never happens (???), using timeout as a fallback
var adblockpInitialized = false;
window.addEventListener("load", adblockpInit, false);
window.setTimeout(adblockpInit, 1000);

function adblockpInit() {
  // Prevent from initializing twice
  if (adblockpInitialized)
    return;

  if (!document.getElementById("contentAreaContextMenu")) {
    window.setTimeout(adblockpInit, 1000);
    return;
  }

  adblockpInitialized = true;
  window.addEventListener("unload", adblockpUnload, false);

  // Process preferences
  adblockpReloadPrefs();
  if (adblockp)
    adblockp.addPrefListener(adblockpReloadPrefs);

  // Install context menu handler
  document.getElementById("contentAreaContextMenu").addEventListener("popupshowing", adblockpCheckContext, false);

  // Check whether Adblock is installed and uninstall
  if (!adblockpPrefs.checkedadblockinstalled)
    setTimeout(adblockpCheckExtensionConflicts, 0);
}

function adblockpUnload() {
  adblockp.removePrefListener(adblockpReloadPrefs);
}

function adblockpReloadPrefs() {
  var status = document.getElementById("adblockplus-status");

  if (status) {
    var state;
    if (adblockp) {
      status.setAttribute("clickable", "true");
      if (adblockpPrefs.enabled)
        state = "active";
      else
        state = "disabled";

      status.setAttribute("label", adblockp.getString("status_" + state + "_label"));
      status.setAttribute("tooltiptext", adblockp.getString("status_" + state + "_tooltip"));
    }

    if (adblockpPrefs.enabled)
      status.removeAttribute("disabled");
    else
      status.setAttribute("disabled", "true");
  }
}

// Check whether Adblock is installed and uninstall
function adblockpCheckExtensionConflicts() {
  // Make sure not to run this twice
  adblockpPrefs.checkedadblockinstalled = true;
  adblockp.savePrefs();

  if ("@mozilla.org/adblock;1" in Components.classes) {
    var promptService = Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
                                  .getService(Components.interfaces.nsIPromptService);
    // Adblock is installed
    if ("@mozilla.org/extensions/manager;1" in Components.classes) {
      // Extension Manager available, ask whether to uninstall
      var result = promptService.confirm(window, adblockp.getString("uninstall_adblock_title"),
                                         adblockp.getString("uninstall_adblock_text"));
      if (!result)
        return;

      try {
        var id = Components.ID("{34274bf4-1d97-a289-e984-17e546307e4f}");
        var extensionManager = Components.classes["@mozilla.org/extensions/manager;1"]
                                         .getService(Components.interfaces.nsIExtensionManager);

        if ('uninstallItem' in extensionManager) {
          // FF 1.1+
          extensionManager.uninstallItem(id);
        }
        else {
          // FF 1.0
          // This seems to fail with the error "this._ds has no properties",
          // but only if the check isn't done immediately after installation.
          extensionManager.uninstallExtension(id);
        }
        promptService.alert(window, adblockp.getString("uninstall_adblock_title"),
                                    adblockp.getString("uninstall_adblock_success"));
      }
      catch (e) {
        dump("Adblock Plus: error uninstalling Adblock, " + e + "\n");
        promptService.alert(window, adblockp.getString("uninstall_adblock_title"),
                                    adblockp.getString("uninstall_adblock_error"));
      }
    }
    else {
      // No extension manager, recomend manual uninstall
      promptService.alert(window, adblockp.getString("uninstall_adblock_title"),
                                  adblockp.getString("uninstall_adblock_manually"));
    }
  }
}

// Fills the context menu on the status bar
function adblockpFillPopup() {
  if (!adblockp)
    return false;

  document.getElementById("adblockplus-sidebar").hidden = !("toggleSidebar" in window);

  var insecLocation = secureGet(content, "location");
  var showWhitelist = adblockp.isBlockableScheme(insecLocation);
  var whitelistItemSite = document.getElementById("adblockplus-whitelist-site");
  var whitelistItemPage = document.getElementById("adblockplus-whitelist-page");
  if (showWhitelist) {
    var url = secureGet(insecLocation, "href").replace(/\?.*/, '');
    var host = secureGet(insecLocation, "host");
    var site = secureGet(insecLocation, "protocol") + "//" + host;

    whitelistItemSite.pattern = "@@" + site;
    whitelistItemSite.setAttribute("checked", adblockpHasPattern(whitelistItemSite.pattern));
    whitelistItemSite.setAttribute("label", whitelistItemSite.getAttribute("labeltempl").replace(/--/, host));

    whitelistItemPage.pattern = "@@" + url;
    whitelistItemPage.setAttribute("checked", adblockpHasPattern(whitelistItemPage.pattern));
  }
  document.getElementById("adblockplus-whitelist-sep").hidden =
    whitelistItemSite.hidden = whitelistItemPage.hidden = !showWhitelist;

  document.getElementById("adblockplus-enabled").setAttribute("checked", adblockpPrefs.enabled);
  document.getElementById("adblockplus-frameobjects").setAttribute("checked", adblockpPrefs.frameobjects);
  document.getElementById("adblockplus-slowcollapse").setAttribute("checked", !adblockpPrefs.fastcollapse);
  document.getElementById("adblockplus-linkcheck").setAttribute("checked", adblockpPrefs.linkcheck);
  return true;
}

// Checks whether the specified pattern exists in the list
function adblockpHasPattern(pattern) {
  for (var i = 0; i < adblockpPrefs.patterns.length; i++)
    if (adblockpPrefs.patterns[i] == pattern)
      return true;

  return false;
}

// Toggles the value of a boolean pref
function adblockpTogglePref(pref) {
  if (!adblockp)
    return;

  adblockpPrefs[pref] = !adblockpPrefs[pref];
  adblockp.savePrefs();
}

// Inserts or removes the specified pattern into/from the list
function adblockpTogglePattern(pattern, insert) {
  if (!adblockp)
    return;

  var found = false;
  for (var i = 0; i < adblockpPrefs.patterns.length; i++) {
    if (adblockpPrefs.patterns[i] == pattern) {
      if (insert)
        found = true;
      else {
        adblockpPrefs.patterns.splice(i, 1);
        i--;
      }
    }
  }
  if (!found && insert)
    adblockpPrefs.patterns.push(pattern);

  adblockp.savePrefs();
}

// Handle clicks on the Adblock statusbar panel
function adblockpClickHandler(e) {
  if (!adblockp)
    return;

  if (e.button == 0 && new Date().getTime() - adblockpLastDrag > 100)
    adblockpSettings();
  else if (e.button == 1)
    adblockpTogglePref("enabled");
}

// Handles Drag&Drop of links and images to the Adblock statusbar panel
function adblockpDragHandler(e) {
  if (!adblockp)
    return;

  var dragService = Components.classes['@mozilla.org/widget/dragservice;1']
                              .getService(Components.interfaces.nsIDragService);
  var session = dragService.getCurrentSession();
  if (!session)
    return;

  var link = null;
  for (var insecNode = session.sourceNode; insecNode && !link; insecNode = secureGet(insecNode, "parentNode")) {
    if (insecNode instanceof HTMLAnchorElement)
      link = secureGet(insecNode, "href");
    else if (insecNode instanceof HTMLImageElement)
      link = secureGet(insecNode, "src");
  }

  if (e.type == "dragover")
    session.canDrop = (link != null);
  else if (link)
    adblockpSettings(link);

  e.preventDefault();
  e.stopPropagation();
}

var adblockpDraggingX = -1;
var adblockpLastDrag = -1;

// Allows activating/deactivating with a drag gesture on the Adblock status bar item
function adblockpMouseHandler(e) {
  if (!adblockp || e.button != 0)
    return;

  if (e.type == "mousedown") {
    adblockpDraggingX = e.clientX;
    e.target.addEventListener("mouseup", adblockpMouseHandler, false);
    e.target.addEventListener("mouseout", adblockpMouseHandler, false);
  }
  else if (e.type == "mouseout" || e.type == "mouseup") {
    e.target.removeEventListener("mouseup", adblockpMouseHandler, false);
    e.target.removeEventListener("mouseout", adblockpMouseHandler, false);
    if (e.type == "mouseup" && adblockpDraggingX >= 0 && Math.abs(e.clientX - adblockpDraggingX) > 10) {
      adblockpPrefs.enabled = !adblockpPrefs.enabled;
      adblockp.savePrefs();
      adblockpLastDrag = new Date().getTime();
    }
    adblockpDraggingX = -1;
  }
}

// Hides the unnecessary context menu items on display
function adblockpCheckContext() {
  var insecTarget = gContextMenu.target;

  var insecFrame = secureGet(insecTarget, "ownerDocument", "defaultView", "frameElement");
  gContextMenu.insecAdblockFrame = insecFrame;

  var nodeType = null;
  if (adblockp) {
    var data = adblockp.getDataForNode(insecTarget);
    gContextMenu.adblockpData = data;
    if (data && !data.filter)
      nodeType = data.typeDescr;
  }

  gContextMenu.showItem("adblockplus-frame-menuitem", adblockp && insecFrame);
  gContextMenu.showItem('adblockplus-image-menuitem', nodeType == "IMAGE" || nodeType == "BACKGROUND");
  gContextMenu.showItem('adblockplus-object-menuitem', nodeType == "OBJECT");
}

// Bring up the settings dialog for the node the context menu was referring to
function adblockpNode() {
  var data = gContextMenu.adblockpData;
  if (data)
    adblockpSettings(data.location);
}

// Bring up the settings dialog for the frame the context menu was referring to
function adblockpFrame() {
  var insecFrame = gContextMenu.insecAdblockFrame;
  if (insecFrame)
    adblockpSettings(secureGet(insecFrame, "contentWindow", "location", "href"));
}

// Open the settings window.
function adblockpSettings(url) {
  if (!adblockp)
    return;

  adblockp.openSettingsDialog(getBrowser().contentWindow, url);
}

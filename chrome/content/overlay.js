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

var abp = null;
try {
  abp = Components.classes["@mozilla.org/adblockplus;1"]
                      .getService(Components.interfaces.nsISupports);
  while (abp && !('getPrefs' in abp))
    abp = abp.wrappedJSObject;    // Unwrap Adblock Plus component
} catch (e) {}

var abpPrefs = abp ? abp.getPrefs() : {enabled: false};

// With older Mozilla versions load event never happens (???), using timeout as a fallback
var abpInitialized = false;
window.addEventListener("load", abpInit, false);
window.setTimeout(abpInit, 1000);

function abpInit() {
  // Prevent from initializing twice
  if (abpInitialized)
    return;

  if (!document.getElementById("contentAreaContextMenu")) {
    window.setTimeout(abpInit, 1000);
    return;
  }

  abpInitialized = true;
  window.addEventListener("unload", abpUnload, false);

  // Process preferences
  abpReloadPrefs();
  if (abp)
    abp.addPrefListener(abpReloadPrefs);

  // Install context menu handler
  document.getElementById("contentAreaContextMenu").addEventListener("popupshowing", abpCheckContext, false);

  // Check whether Adblock is installed and uninstall
  // Delay it so the browser window will be displayed before the warning
  if (abp && !abpPrefs.checkedadblockinstalled)
    setTimeout(abpCheckExtensionConflicts, 0);

  // Install toolbar button in Firefox if necessary
  if (abp && !abpPrefs.checkedtoolbar)
    setTimeout(abpInstallInToolbar, 0);
}

function abpUnload() {
  abp.removePrefListener(abpReloadPrefs);
}

function abpReloadPrefs() {
  var label;
  var state = null;
  if (abp) {
    if (abpPrefs.enabled)
      state = "active";
    else
      state = "disabled";

    label = abp.getString("status_" + state + "_label");
  }

  var tooltip = document.getElementById("abp-tooltip");
  if (state && tooltip)
    tooltip.setAttribute("label", abp.getString("status_" + state + "_tooltip"));

  var updateElement = function(element) {
    if (!element)
      return;

    if (abp) {
      element.removeAttribute("disabled");

      if (element.tagName == "statusbarpanel") {
        element.setAttribute("label", label);
        element.hidden = !abpPrefs.showinstatusbar;
      }
    }

    if (abpPrefs.enabled)
      element.removeAttribute("deactivated");
    else
      element.setAttribute("deactivated", "true");
  }

  updateElement(document.getElementById("abp-status"));
  updateElement(document.getElementById("abp-toolbarbutton"));

  // Need to update the button in the palette as well
  var toolbox = document.getElementById("navigator-toolbox");
  if (toolbox && "palette" in toolbox && toolbox.palette)
    for (var child = toolbox.palette.firstChild; child; child = child.nextSibling)
      if (child.id == "abp-toolbarbutton")
        updateElement(child);
}

// Check whether Adblock is installed and uninstall
function abpCheckExtensionConflicts() {
  // Make sure not to run this twice
  abpPrefs.checkedadblockinstalled = true;
  abp.savePrefs();

  if ("@mozilla.org/adblock;1" in Components.classes) {
    var promptService = Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
                                  .getService(Components.interfaces.nsIPromptService);
    // Adblock is installed
    if ("@mozilla.org/extensions/manager;1" in Components.classes) {
      // Extension Manager available, ask whether to uninstall
      var result = promptService.confirm(window, abp.getString("uninstall_adblock_title"),
                                         abp.getString("uninstall_adblock_text"));
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
        promptService.alert(window, abp.getString("uninstall_adblock_title"),
                                    abp.getString("uninstall_adblock_success"));
      }
      catch (e) {
        dump("Adblock Plus: error uninstalling Adblock, " + e + "\n");
        promptService.alert(window, abp.getString("uninstall_adblock_title"),
                                    abp.getString("uninstall_adblock_error"));
      }
    }
    else {
      // No extension manager, recomend manual uninstall
      promptService.alert(window, abp.getString("uninstall_adblock_title"),
                                  abp.getString("uninstall_adblock_manually"));
    }
  }
}

// Check whether we installed the toolbar button already
function abpInstallInToolbar() {
  if (!document.getElementById("abp-toolbarbutton")) {
    var toolbar = document.getElementById("nav-bar");
    if (toolbar && "insertItem" in toolbar) {
      toolbar.insertItem("abp-toolbarbutton", document.getElementById("urlbar-container"), null, false);

      // Need this to make FF 1.0 persist the new button
      toolbar.setAttribute("currentset", toolbar.currentSet);
      document.persist("nav-bar", "currentset");
    }
  }

  // Make sure not to run this twice
  abpPrefs.checkedtoolbar = true;
  abp.savePrefs();
}

// Fills the context menu on the status bar
function abpFillPopup(prefix) {
  if (!abp)
    return false;

  var hasSidebar = ("toggleSidebar" in window);
  var sidebarOpen = (hasSidebar && document.getElementById("viewAdblockPlusSidebar").getAttribute("checked") == "true");
  document.getElementById(prefix+"-opensidebar").hidden = !hasSidebar || sidebarOpen;
  document.getElementById(prefix+"-closesidebar").hidden = !hasSidebar || !sidebarOpen;

  var insecLocation = secureGet(content, "location");
  var showWhitelist = abp.isBlockableScheme(insecLocation);
  var whitelistItemSite = document.getElementById(prefix+"-whitelist-site");
  var whitelistItemPage = document.getElementById(prefix+"-whitelist-page");
  if (showWhitelist) {
    var url = secureGet(insecLocation, "href").replace(/\?.*/, '');
    var host = secureGet(insecLocation, "host");
    var site = url.replace(/^([^\/]+\/\/[^\/]+\/).*/, "$1");

    whitelistItemSite.pattern = "@@" + site;
    whitelistItemSite.setAttribute("checked", abpHasPattern(whitelistItemSite.pattern));
    whitelistItemSite.setAttribute("label", whitelistItemSite.getAttribute("labeltempl").replace(/--/, host));

    whitelistItemPage.pattern = "@@" + url;
    whitelistItemPage.setAttribute("checked", abpHasPattern(whitelistItemPage.pattern));
  }
  document.getElementById(prefix+"-whitelist-sep").hidden =
    whitelistItemSite.hidden = whitelistItemPage.hidden = !showWhitelist;

  document.getElementById(prefix+"-enabled").setAttribute("checked", abpPrefs.enabled);
  document.getElementById(prefix+"-showinstatusbar").setAttribute("checked", abpPrefs.showinstatusbar);
  document.getElementById(prefix+"-localpages").setAttribute("checked", abpPrefs.blocklocalpages);
  document.getElementById(prefix+"-frameobjects").setAttribute("checked", abpPrefs.frameobjects);
  document.getElementById(prefix+"-slowcollapse").setAttribute("checked", !abpPrefs.fastcollapse);
  document.getElementById(prefix+"-linkcheck").setAttribute("checked", abpPrefs.linkcheck);
  return true;
}

// Checks whether the specified pattern exists in the list
function abpHasPattern(pattern) {
  for (var i = 0; i < abpPrefs.patterns.length; i++)
    if (abpPrefs.patterns[i] == pattern)
      return true;

  return false;
}

// Toggles the value of a boolean pref
function abpTogglePref(pref) {
  if (!abp)
    return;

  abpPrefs[pref] = !abpPrefs[pref];
  abp.savePrefs();
}

// Inserts or removes the specified pattern into/from the list
function abpTogglePattern(pattern, insert) {
  if (!abp)
    return;

  var found = false;
  for (var i = 0; i < abpPrefs.patterns.length; i++) {
    if (abpPrefs.patterns[i] == pattern) {
      if (insert)
        found = true;
      else {
        abpPrefs.patterns.splice(i, 1);
        i--;
      }
    }
  }
  if (!found && insert)
    abpPrefs.patterns.push(pattern);

  abp.savePrefs();
}

// Handle clicks on the Adblock statusbar panel
function abpClickHandler(e) {
  if (e.button == 0 && new Date().getTime() - abpLastDrag > 100)
    abpSettings();
  else if (e.button == 1)
    abpTogglePref("enabled");
}

// Handles Drag&Drop of links and images to the Adblock statusbar panel
function abpDragHandler(e) {
  if (!abp)
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
    abpSettings(link);

  e.preventDefault();
  e.stopPropagation();
}

var abpDraggingX = -1;
var abpLastDrag = -1;

// Allows activating/deactivating with a drag gesture on the Adblock status bar item
function abpMouseHandler(e) {
  if (!abp || e.button != 0)
    return;

  if (e.type == "mousedown") {
    abpDraggingX = e.clientX;
    e.target.addEventListener("mouseup", abpMouseHandler, false);
    e.target.addEventListener("mouseout", abpMouseHandler, false);
  }
  else if (e.type == "mouseout" || e.type == "mouseup") {
    e.target.removeEventListener("mouseup", abpMouseHandler, false);
    e.target.removeEventListener("mouseout", abpMouseHandler, false);
    if (e.type == "mouseup" && abpDraggingX >= 0 && Math.abs(e.clientX - abpDraggingX) > 10) {
      abpPrefs.enabled = !abpPrefs.enabled;
      abp.savePrefs();
      abpLastDrag = new Date().getTime();
    }
    abpDraggingX = -1;
  }
}

// Hides the unnecessary context menu items on display
function abpCheckContext() {
  var insecTarget = gContextMenu.target;

  var insecFrame = secureGet(insecTarget, "ownerDocument", "defaultView", "frameElement");
  gContextMenu.insecAdblockFrame = insecFrame;

  var nodeType = null;
  gContextMenu.abpLink = null;
  if (abp) {
    // Lookup the node in our stored data
    var data = abp.getDataForNode(insecTarget);
    gContextMenu.abpData = data;
    if (data && !data.filter)
      nodeType = data.typeDescr;

    if (abpPrefs.linkcheck && (nodeType == "IMAGE" || nodeType == "OBJECT" /*|| nodeType == "BACKGROUND"*/)) {
      // Look for a parent link
      while (insecTarget && (secureGet(insecTarget, "href") == null || !abp.isBlockableScheme(insecTarget)))
        insecTarget = secureGet(insecTarget, "parentNode");

      if (insecTarget)
        gContextMenu.abpLink = secureGet(insecTarget, "href");
    }
  }


  gContextMenu.showItem("abp-frame-menuitem", abp && insecFrame);
  // XXX: Can't block background images via context menu. Can this be solved?
  gContextMenu.showItem('abp-image-menuitem', nodeType == "IMAGE" /* || nodeType == "BACKGROUND"*/);
  gContextMenu.showItem('abp-object-menuitem', nodeType == "OBJECT");
  gContextMenu.showItem('abp-link-menuitem', gContextMenu.abpLink != null);
}

// Bring up the settings dialog for the node the context menu was referring to
function abpNode() {
  var data = gContextMenu.abpData;
  if (data)
    abpSettings(data.location);
}

// Bring up the settings dialog for the link the context menu was referring to
function abpLink() {
  var link = gContextMenu.abpLink;
  if (link)
    abpSettings(link);
}

// Bring up the settings dialog for the frame the context menu was referring to
function abpFrame() {
  var insecFrame = gContextMenu.insecAdblockFrame;
  if (insecFrame)
    abpSettings(secureGet(insecFrame, "contentWindow", "location", "href"));
}

// Open the settings window.
function abpSettings(url) {
  if (!abp)
    return;

  abp.openSettingsDialog(getBrowser().contentWindow, url);
}

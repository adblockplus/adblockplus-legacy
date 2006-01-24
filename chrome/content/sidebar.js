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
  abp = Components.classes["@mozilla.org/adblockplus;1"].getService();
  while (abp && !('getPrefs' in abp))
    abp = abp.wrappedJSObject;    // Unwrap component

  var flasher = abp.getFlasher();
} catch (e) {}

// Main browser window
var mainWin = parent;

// The window handler currently in use
var wndData = null;

var suggestionItems = [];
var itemsDummy, remoteDummy, whitelistDummy, loadDummy;
var currentDummy = null;

function init() {
  var filterSuggestions = document.getElementById("suggestionsList");
  itemsDummy = document.getElementById("noItemsDummy");
  itemsDummy.parentNode.removeChild(itemsDummy);
  remoteDummy = document.getElementById("notRemoteDummy");
  remoteDummy.parentNode.removeChild(remoteDummy);
  whitelistDummy = document.getElementById("whitelistedDummy");
  whitelistDummy.parentNode.removeChild(whitelistDummy);
  loadDummy = document.getElementById("notLoadedDummy");
  loadDummy.parentNode.removeChild(loadDummy);

  if (/sidebarDetached\.xul$/.test(parent.location.href)) {
    mainWin = parent.arguments[0];
    window.__defineGetter__("content", function() {return mainWin.getBrowser().contentWindow});
    mainWin.addEventListener("unload", mainUnload, false);
    document.getElementById("detachButton").hidden = true;
    document.getElementById("reattachButton").hidden = false;
    if (parent.arguments.length > 1 && parent.arguments[1])
      document.getElementById("reattachButton").setAttribute("disabled", "true");
  } else if (abp && abp.getPrefs().detachsidebar) {
    // Oops, we should've been detached but we aren't
    detach();
  }

  if (abp) {
    itemsDummy.location = abp.getString("no_blocking_suggestions");
    remoteDummy.location = abp.getString("not_remote_page");
    whitelistDummy.location = abp.getString("whitelisted_page");
  }

  var data = [];
  if (abp) {
    // Retrieve data for the window
    wndData = abp.getDataForWindow(window.content);
    data = wndData.getAllLocations();
    wndData.addLocationListener(handleLocationsChange);

    // Activate flasher
    filterSuggestions.addEventListener("select", function() {
      var item = filterSuggestions.selectedItem;
      if (item)
        item = item.firstChild.nextSibling;

      var loc = null;
      if (item)
        loc = wndData.getLocation(item.getAttribute("label"));
      flasher.flash(loc ? loc.inseclNodes : null);
    }, false);

    // Revalidate nodes periodically
    setInterval(function() {
      if (wndData)
        wndData.getAllLocations();
    }, 2000);

    // Install a handler for tab changes
    mainWin.getBrowser().addEventListener("select", handleTabChange, false);
  }

  if (data.length) {
    // Initialize filter suggestions dropdown
    for (var i = 0; i < data.length; i++)
      createFilterSuggestion(filterSuggestions, data[i]);
  }
  else
    insertDummy(filterSuggestions);
}

// To be called for a detached window when the main window has been closed
function mainUnload() {
  parent.close();
}

// Decides which dummy item to insert into the list
function insertDummy(list) {
  removeDummy();

  currentDummy = loadDummy;
  if (abp) {
    currentDummy = itemsDummy;

    var insecLocation = secureGet(window.content, "location");
    // We want to stick with "no blockable items" for about:blank
    if (secureGet(insecLocation, "href") != "about:blank") {
      if (!abp.isBlockableScheme(insecLocation))
        currentDummy = remoteDummy;
      else {
        var filter = abp.isWhitelisted(secureGet(insecLocation, "href"));
        if (filter) {
          currentDummy = whitelistDummy;
          currentDummy.filter = filter;
        }
      }
    }
  }
  list.appendChild(currentDummy);
}

// Removes the dummy from the list
function removeDummy() {
  if (currentDummy && currentDummy.parentNode)
    currentDummy.parentNode.removeChild(currentDummy);

  currentDummy = null;
}

// To be called on unload
function cleanUp() {
  if (!abp)
    return;

  flasher.stop();
  if (wndData)
    wndData.removeLocationListener(handleLocationsChange);

  mainWin.getBrowser().removeEventListener("select", handleTabChange, false);
  mainWin.removeEventListener("unload", mainUnload, false);
}

function createListCell(label, crop, filter) {
  var result = document.createElement("listcell");
  result.setAttribute("label", label);
  if (crop)
    result.setAttribute("crop", "center");
  if (filter && filter.isWhite)
    result.className = "whitelist";
  else if (filter)
    result.setAttribute("disabled", "true");
  return result;
}

function createFilterSuggestion(listbox, suggestion) {
  var listitem = document.createElement("listitem");

  listitem.appendChild(createListCell(suggestion.localizedDescr, false, suggestion.filter));
  listitem.appendChild(createListCell(suggestion.location, true, suggestion.filter));
  listitem.filter = suggestion.filter;
  listitem.location = suggestion.location;

  listbox.appendChild(listitem);

  suggestionItems.push(listitem);
  suggestionItems[" " + suggestion.location] = listitem;
}

function handleLocationsChange(loc, added) {
  var i;
  var filterSuggestions = document.getElementById("suggestionsList");
  if (added) {
    removeDummy();

    // Add a new suggestion
    createFilterSuggestion(filterSuggestions, loc);
  }
  else if (loc) {
    var key = " " + loc.location;
    if (key in suggestionItems) {
      filterSuggestions.removeChild(suggestionItems[key]);
      for (i = 0; i < suggestionItems.length; i++) {
        if (suggestionItems[i] == suggestionItems[key]) {
          suggestionItems.splice(i, 1);
          break;
        }
      }
      delete suggestionItems[key];

      // Insert dummy
      if (suggestionItems.length == 0)
        insertDummy(filterSuggestions);
    }
  }
  else {
    // Clear list
    for (i = 0; i < suggestionItems.length; i++)
      filterSuggestions.removeChild(suggestionItems[i]);

    suggestionItems = [];

    // Insert dummy
    insertDummy(filterSuggestions);
  }
}

function handleTabChange() {
  // Accessing controllers.getControllerForCommand in a newly
  // created tab crashes Firefox 1.5, have to delay this (bug 323641).
  var initialized = false;
  try {
    var requestor = secureLookup(window.content, "QueryInterface")(Components.interfaces.nsIInterfaceRequestor);
    var webNav = secureLookup(requestor, "getInterface")(Components.interfaces.nsIWebNavigation);
    initialized = (webNav.currentURI != null);
  } catch(e) {}

  if (!initialized) {
    setTimeout(handleTabChange, 10);
    return;
  }

  // Clear list
  handleLocationsChange(null, false);
  wndData.removeLocationListener(handleLocationsChange);

  // Re-init with the new window
  wndData = abp.getDataForWindow(window.content);
  wndData.addLocationListener(handleLocationsChange);

  var data = wndData.getAllLocations();
  for (var i = 0; i < data.length; i++)
    handleLocationsChange(data[i], true);
}

// Shows tooltop with the full uncropped location
function fillInTooltip(event) {
  var node = document.tooltipNode;
  while (node && node.tagName != "listitem")
    node = node.parentNode;

  if (!node || !("location" in node))
    return false;

  var pattern = ("filter" in node && node.filter ? node.filter.origPattern : null);
  document.getElementById("tooltipText").setAttribute("value", node.location);
  document.getElementById("tooltipFilter").hidden = !pattern;
  document.getElementById("tooltipFilterText").setAttribute("value", pattern);
  return true;
}

// Handles middle-click on an item
function openInTab(e) {
  // Only middle-clicks are handled
  if (e.button != 1)
    return;

  // Look for a listitem element in the parents chain
  var node = e.target;
  while (node && !(node.nodeType == node.ELEMENT_NODE && node.tagName == "listitem"))
    node = node.parentNode;

  // Ignore click if user didn't click a list item or clicked one of our dummy items
  if (!node || /Dummy$/.test(node.id))
    return;

  if (!node.firstChild || !node.firstChild.nextSibling)
    return;

  var url = node.firstChild.nextSibling.getAttribute("label");
  mainWin.delayedOpenTab(url);
}

// Starts up the main Adblock window
function doAdblock() {
  if (!abp)
    return;

  var listitem = document.getElementById("suggestionsList").selectedItem;
  if (!listitem || !("filter" in listitem))
    return;

  // No location for the dummy item
  var location = (listitem.id ? undefined : listitem.location);
  abp.openSettingsDialog(window.content, location, listitem.filter);
}

// detaches the sidebar
function detach() {
  if (!abp)
    return;

  // Calculate default position for the detached window
  var boxObject = document.documentElement.boxObject;
  var position = ",left="+boxObject.screenX+",top="+boxObject.screenY+",outerWidth="+boxObject.width+",outerHeight="+boxObject.height;

  // Close sidebar and open detached window
  var wnd = mainWin.abpDetachedSidebar;
  mainWin.abpDetachedSidebar = null;
  abp.getPrefs().detachsidebar = false;
  mainWin.abpToggleSidebar();
  if (wnd && !wnd.closed) {
    wnd.focus();
    mainWin.abpDetachedSidebar = wnd;
  }
  else
    mainWin.abpDetachedSidebar = openDialog("chrome://adblockplus/content/sidebarDetached.xul", "_blank", "chrome,all"+position, parent);

  // Save setting
  abp.getPrefs().detachsidebar = true;
  abp.savePrefs();
}

// reattaches the sidebar
function reattach() {
  if (!abp)
    return;

  // Save setting
  abp.getPrefs().detachsidebar = false;
  abp.savePrefs();

  // Open sidebar in window
  mainWin.abpDetachedSidebar = null;
  mainWin.abpToggleSidebar();
  parent.close();
}

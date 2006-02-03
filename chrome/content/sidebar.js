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
  abp = Components.classes["@mozilla.org/adblockplus;1"].createInstance();
  while (abp && !('getString' in abp))
    abp = abp.wrappedJSObject;    // Unwrap component

  var prefs = abp.prefs;
  var flasher = abp.flasher;
  var DataContainer = abp.DataContainer;
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
  } else if (abp && prefs.detachsidebar) {
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
    // Install location listener
    DataContainer.addListener(handleLocationsChange);

    // Retrieve data for the window
    wndData = DataContainer.getDataForWindow(window.content);
    data = wndData.getAllLocations();

    // Activate flasher
    filterSuggestions.addEventListener("select", function() {
      if (!wndData)
        return;

      var item = filterSuggestions.selectedItem;
      if (item)
        item = item.firstChild.nextSibling;

      var loc = null;
      if (item)
        loc = wndData.getLocation(item.getAttribute("label"));
      flasher.flash(loc ? loc.inseclNodes : null);
    }, false);

    // Update dummy whenever necessary
    setInterval(function() {
      if (suggestionItems.length == 0)
        insertDummy(filterSuggestions);
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
      if (!abp.policy.isBlockableScheme(insecLocation))
        currentDummy = remoteDummy;
      else {
        var filter = abp.policy.isWhitelisted(secureGet(insecLocation, "href"));
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
  DataContainer.removeListener(handleLocationsChange);

  mainWin.getBrowser().removeEventListener("select", handleTabChange, false);
  mainWin.removeEventListener("unload", mainUnload, false);
}

function createListCell(label, crop) {
  var result = document.createElement("listcell");
  result.setAttribute("label", label);
  if (crop)
    result.setAttribute("crop", "center");
  return result;
}

function createFilterSuggestion(listbox, suggestion) {
  var listitem = document.createElement("listitem");

  listitem.appendChild(createListCell(suggestion.localizedDescr, false));
  listitem.appendChild(createListCell(suggestion.location, true));
  listitem.filter = suggestion.filter;
  listitem.location = suggestion.location;
  if (listitem.filter && listitem.filter.isWhite)
    listitem.className = "whitelisted";
  else if (listitem.filter)
    listitem.className = "filtered";

  listbox.appendChild(listitem);

  suggestionItems.push(listitem);
}

function handleLocationsChange(type, data, loc) {
  // Check whether this applies to us
  if (data.insecWnd != window.content)
    return;

  // Maybe we got called twice
  if (type == "select" && data == wndData)
    return;

  // If adding something from a new data container - select it
  if (type == "add" && data != wndData)
    type = "select";

  var i;
  var filterSuggestions = document.getElementById("suggestionsList");
  if (type == "select" || type == "refresh" || type == "clear") {
    // We moved to a different document, clear list
    filterSuggestions.selectedItem = filterSuggestions.currentItem = null;
    for (i = 0; i < suggestionItems.length; i++)
      filterSuggestions.removeChild(suggestionItems[i]);

    suggestionItems = [];

    if (type == "clear")
      wndData = null;
    else {
      wndData = data;

      // Add new items
      var locations = wndData.getAllLocations();
      for (i = 0; i < locations.length; i++)
        handleLocationsChange("add", wndData, locations[i]);
    }
  } else if (type == "add") {
    removeDummy();

    // Add a new suggestion
    createFilterSuggestion(filterSuggestions, loc);
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

  // Use new data
  handleLocationsChange("select", DataContainer.getDataForWindow(window.content));
}

// Shows tooltop with the full uncropped location
function fillInTooltip(event) {
  var node = document.tooltipNode;
  while (node && (node.nodeType != node.ELEMENT_NODE || node.tagName != "listitem"))
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
  prefs.detachsidebar = false;
  mainWin.abpToggleSidebar();
  if (wnd && !wnd.closed) {
    wnd.focus();
    mainWin.abpDetachedSidebar = wnd;
  }
  else
    mainWin.abpDetachedSidebar = openDialog("chrome://adblockplus/content/sidebarDetached.xul", "_blank", "chrome,all,dependent"+position, parent);

  // Save setting
  prefs.detachsidebar = true;
  prefs.save();
}

// reattaches the sidebar
function reattach() {
  if (!abp)
    return;

  // Save setting
  prefs.detachsidebar = false;
  prefs.save();

  // Open sidebar in window
  mainWin.abpDetachedSidebar = null;
  mainWin.abpToggleSidebar();
  parent.close();
}

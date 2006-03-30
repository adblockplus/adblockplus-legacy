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

  if (abp.prefs.initialized) {
    var prefs = abp.prefs;
    var flasher = abp.flasher;
    var DataContainer = abp.DataContainer;
  }
  else
    abp = null;
} catch (e) {}

// Main browser window
var mainWin = parent;

// The window handler currently in use
var wndData = null;

function init() {
  var list = document.getElementById("list");
  list.view = treeView;

  var selected = null;
  if (/sidebarDetached\.xul$/.test(parent.location.href)) {
    mainWin = parent.opener;
    window.__defineGetter__("content", function() {return mainWin.getBrowser().contentWindow});
    mainWin.addEventListener("unload", mainUnload, false);
    document.getElementById("detachButton").hidden = true;
    document.getElementById("reattachButton").hidden = false;
    if ("abpForceDetach" in mainWin && mainWin.abpForceDetach)
      document.getElementById("reattachButton").setAttribute("disabled", "true");
  } else if (abp && prefs.detachsidebar) {
    // Oops, we should've been detached but we aren't
    detach();
  }
  else {
    // Just for EzSidebar's sake :-(
    mainWin = mainWin.getBrowser().ownerDocument.defaultView;
  }

  if (abp) {
    // Install item listener
    DataContainer.addListener(handleItemChange);

    // Restore previous state
    var params = abp.getParams();
    if (params && params.filter) {
      document.getElementById("searchField").value = params.filter;
      treeView.setFilter(params.filter);
    }
    if (params && params.focus && document.getElementById(params.focus))
      document.getElementById(params.focus).focus();
    else
      document.getElementById("searchField").focus();

    // Retrieve data for the window
    wndData = DataContainer.getDataForWindow(window.content);
    treeView.setData(wndData.getAllLocations());
    if (params && params.selected) {
      treeView.selectItem(params.selected);
      onSelectionChange();
    }

    // Activate flasher
    list.addEventListener("select", onSelectionChange, false);

    // Install a handler for tab changes
    mainWin.getBrowser().addEventListener("select", handleTabChange, false);
  }
}

// To be called for a detached window when the main window has been closed
function mainUnload() {
  parent.close();
}

// To be called on unload
function cleanUp() {
  if (!abp)
    return;

  flasher.stop();
  DataContainer.removeListener(handleItemChange);

  mainWin.getBrowser().removeEventListener("select", handleTabChange, false);
  mainWin.removeEventListener("unload", mainUnload, false);
}

// Called whenever list selection changes - triggers flasher
function onSelectionChange() {
  var item = treeView.getSelectedItem();
  if (item)
    document.getElementById("copy-command").removeAttribute("disabled");
  else
    document.getElementById("copy-command").setAttribute("disabled", "true");
  flasher.flash(item ? item.inseclNodes : null);
}

function handleItemChange(insecWnd, type, data, item) {
  // Check whether this applies to us
  if (insecWnd != window.content)
    return;

  // Maybe we got called twice
  if (type == "select" && data == wndData)
    return;

  // If adding something from a new data container - select it
  if (type == "add" && data != wndData)
    type = "select";

  var i;
  var filterSuggestions = document.getElementById("suggestionsList");
  if (type == "clear") {
    // Current document has been unloaded, clear list
    wndData = null;
    treeView.setData([]);
  }
  else if (type == "select" || type == "refresh") {
    // We moved to a different document, reload list
    wndData = data;
    treeView.setData(wndData.getAllLocations());
  }
  else if (type == "invalidate")
    treeView.boxObject.invalidate();
  else if (type == "add")
    treeView.addItem(item);
}

function handleTabChange() {
  wndData = DataContainer.getDataForWindow(window.content);
  treeView.setData(wndData.getAllLocations());
}

// Fills a box with text splitting it up into multiple lines if necessary
function setMultilineContent(box, text) {
  while (box.firstChild)
    box.removeChild(box.firstChild);

  for (var i = 0; i < text.length; i += 80) {
    var description = document.createElement("description");
    description.setAttribute("value", text.substr(i, 80));
    box.appendChild(description);
  }
}

// Fill in tooltip data before showing it
function fillInTooltip(e) {
  var item;
  if (treeView.data && !treeView.data.length)
    item = treeView.getDummyTooltip();
  else
    item = treeView.getItemAt(e.clientX, e.clientY);

  if (!item)
    return false;

  var filter = ("filter" in item ? item.filter : null);

  document.getElementById("tooltipDummy").hidden = !("tooltip" in item);
  document.getElementById("tooltipAddressRow").hidden = ("tooltip" in item);
  document.getElementById("tooltipTypeRow").hidden = ("tooltip" in item);
  document.getElementById("tooltipFilterRow").hidden = !filter;

  if ("tooltip" in item)
    document.getElementById("tooltipDummy").setAttribute("value", item.tooltip);
  else {
    setMultilineContent(document.getElementById("tooltipAddress"), item.location);
  
    var type = item.localizedDescr;
    if (filter && filter.type == "whitelist")
      type += " " + document.getElementById("tooltipType").getAttribute("whitelisted");
    else if (filter)
      type += " " + document.getElementById("tooltipType").getAttribute("filtered");
    document.getElementById("tooltipType").setAttribute("value", type);
  }

  if (filter)
    setMultilineContent(document.getElementById("tooltipFilter"), filter.text);

  if (prefs.previewimages && !("tooltip" in item) && (item.typeDescr == "IMAGE" || item.typeDescr == "BACKGROUND") && (!item.filter || item.filter.type == "whitelist")) {
    document.getElementById("tooltipPreviewBox").hidden = false;
    document.getElementById("tooltipPreview").setAttribute("src", "");
    document.getElementById("tooltipPreview").setAttribute("src", item.location);
  }
  else
    document.getElementById("tooltipPreviewBox").hidden = true;

  return true;
}

const visual = {
  OTHER: true,
  IMAGE: true,
  LINK: true,
  SUBDOCUMENT: true
}

// Fill in tooltip data before showing it
function fillInContext(e) {
  var item;
  if (treeView.data && !treeView.data.length)
    item = treeView.getDummyTooltip();
  else
    item = treeView.getItemAt(e.clientX, e.clientY);

  if (!item || ("tooltip" in item && !("filter" in item)))
    return false;

  document.getElementById("contextBlock").hidden = ("filter" in item && item.filter != null);
  document.getElementById("contextEditFilter").hidden = !("filter" in item && item.filter != null);
  document.getElementById("contextWhitelist").setAttribute("disabled", !!("tooltip" in item || (item.filter && item.filter.type == "whitelist")));
  document.getElementById("contextOpen").setAttribute("disabled", "tooltip" in item);
  document.getElementById("contextFlash").setAttribute("disabled", !!("tooltip" in item || !(item.typeDescr in visual) || (item.filter && item.filter.type != "whitelist")));

  return true;
}

// Handles middle-click on an item
function openInTab(e) {
  var item = (typeof e == "undefined" ? treeView.getSelectedItem() : treeView.getItemAt(e.clientX, e.clientY));
  if (!item)
    return;

  mainWin.delayedOpenTab(item.location);
}

// Starts up the main Adblock window
function doBlock() {
  if (!abp)
    return;

  var item = treeView.getSelectedItem();
  if (treeView.data && !treeView.data.length) {
    item = treeView.getDummyTooltip();
    item.location = undefined;
    if (!("filter" in item))
      item.filter = null;
  }

  var location = (item ? item.location : undefined);
  var filter = (item && item.filter ? item.filter : undefined);

  abp.openSettingsDialog(window.content, location, filter);
}

function doWhitelist() {
  if (!abp)
    return;

  var item = treeView.getSelectedItem();
  if (!item)
    return;

  abp.openSettingsDialog(window.content, "@@" + item.location);
}

function copyToClipboard() {
  if (!abp)
    return;

  var item = treeView.getSelectedItem();
  if (!item)
    return;

  var clipboardHelper = Components.classes["@mozilla.org/widget/clipboardhelper;1"]
                                  .getService(Components.interfaces.nsIClipboardHelper);
  clipboardHelper.copyString(item.location);
}

// Saves sidebar's state before detaching/reattaching
function saveState() {
  var focused = document.commandDispatcher.focusedElement;
  while (focused && (!focused.id || !("focus" in focused)))
    focused = focused.parentNode;

  var params = {
    selected: treeView.getSelectedItem(),
    filter: treeView.filter,
    focus: (focused ? focused.id : null)
  };
  abp.setParams(params);
}

// detaches the sidebar
function detach() {
  if (!abp)
    return;

  saveState();

  // In Firefox 1.0 variables disappear immediately, get local copies
  var mainWin = window.mainWin;
  var prefs = window.prefs;

  // Calculate default position for the detached window
  var boxObject = document.documentElement.boxObject;
  var position = ",left="+boxObject.screenX+",top="+boxObject.screenY+",outerWidth="+boxObject.width+",outerHeight="+boxObject.height;

  // Close sidebar and open detached window
  var wnd = mainWin.abpDetachedSidebar;
  mainWin.abpDetachedSidebar = null;
  prefs.detachsidebar = false;

  if ("SidebarGetRelativePanel" in mainWin)
    mainWin.SidebarGetRelativePanel(-1);
  else
    mainWin.abpToggleSidebar();

  if (wnd && !wnd.closed) {
    wnd.focus();
    mainWin.abpDetachedSidebar = wnd;
  }
  else {
    mainWin.abpForceDetach = false;
    mainWin.abpDetachedSidebar = mainWin.openDialog("chrome://adblockplus/content/sidebarDetached.xul", "_blank", "chrome,resizable,dependent,dialog=no"+position);
  }

  // Save setting
  prefs.detachsidebar = true;
  prefs.save();
}

// reattaches the sidebar
function reattach() {
  if (!abp)
    return;

  saveState();

  // Save setting
  prefs.detachsidebar = false;
  prefs.save();

  // Open sidebar in window
  mainWin.abpDetachedSidebar = null;
  mainWin.abpToggleSidebar();
  parent.close();
}

// Sort functions for the item list
function sortByAddress(item1, item2) {
  if (item1.location < item2.location)
    return -1;
  else if (item1.location > item2.location)
    return 1;
  else
    return 0;
}

function sortByAddressDesc(item1, item2) {
  return -sortByAddress(item1, item2);
}

function compareType(item1, item2) {
  if (item1.localizedDescr < item2.localizedDescr)
    return -1;
  else if (item1.localizedDescr > item2.localizedDescr)
    return 1;
  else
    return 0;
}

function compareFilter(item1, item2) {
  var hasFilter1 = (item1.filter ? 1 : 0);
  var hasFilter2 = (item2.filter ? 1 : 0);
  if (hasFilter1 != hasFilter2)
    return hasFilter1 - hasFilter2;
  else if (hasFilter1 && item1.filter.text < item2.filter.text)
    return -1;
  else if (hasFilter1 && item1.filter.text > item2.filter.text)
    return 1;
  else
    return 0;
}

function compareState(item1, item2) {
  var state1 = (!item1.filter ? 0 : (item1.filter.type == "whitelist" ? 1 : 2));
  var state2 = (!item2.filter ? 0 : (item2.filter.type == "whitelist" ? 1 : 2));
  return state1 - state2;
}

function createSortWithFallback(cmpFunc, fallbackFunc, desc) {
  var factor = (desc ? -1 : 1);

  return function(item1, item2) {
    var ret = cmpFunc(item1, item2);
    if (ret == 0)
      return fallbackFunc(item1, item2);
    else
      return factor * ret;
  }
}

// Item list's tree view object
var treeView = {
  //
  // nsISupports implementation
  //

  QueryInterface: function(uuid) {
    if (!uuid.equals(Components.interfaces.nsISupports) &&
        !uuid.equals(Components.interfaces.nsITreeView))
    {
      throw Components.results.NS_ERROR_NO_INTERFACE;
    }
  
    return this;
  },

  //
  // nsITreeView implementation
  //

  selection: null,

  setTree: function(boxObject) {
    if (!boxObject)
      return;

    var i;

    this.boxObject = boxObject;
    this.itemsDummy = boxObject.treeBody.getAttribute("noitemslabel");
    this.remoteDummy = boxObject.treeBody.getAttribute("notremotelabel");
    this.whitelistDummy = boxObject.treeBody.getAttribute("whitelistedlabel");
    this.loadDummy = boxObject.treeBody.getAttribute("notloadedlabel");

    var stringAtoms = ["col-address", "col-type", "col-filter", "col-state", "state-regular", "state-filtered", "state-whitelisted"];
    var boolAtoms = ["selected", "dummy"];
    var atomService = Components.classes["@mozilla.org/atom-service;1"]
                                .getService(Components.interfaces.nsIAtomService);

    this.atoms = {};
    for (i = 0; i < stringAtoms.length; i++)
      this.atoms[stringAtoms[i]] = atomService.getAtom(stringAtoms[i]);
    for (i = 0; i < boolAtoms.length; i++) {
      this.atoms[boolAtoms[i] + "-true"] = atomService.getAtom(boolAtoms[i] + "-true");
      this.atoms[boolAtoms[i] + "-false"] = atomService.getAtom(boolAtoms[i] + "-false");
    }

    if (abp) {
      this.itemsDummyTooltip = abp.getString("no_blocking_suggestions");
      this.remoteDummyTooltip = abp.getString("not_remote_page");
      this.whitelistDummyTooltip = abp.getString("whitelisted_page");
    }

    // Check current sort direction
    var cols = document.getElementsByTagName("treecol");
    var sortDir = null;
    for (i = 0; i < cols.length; i++) {
      var col = cols[i];
      var dir = col.getAttribute("sortDirection");
      if (dir && dir != "natural") {
        this.sortColumn = col;
        sortDir = dir;
      }
    }

    if (sortDir)
      this.sortProc = this.sortProcs[this.sortColumn.id + (sortDir == "descending" ? "Desc" : "")];

    // Make sure to update the dummy row every two seconds
    setInterval(function(view) {
      if (!view.data || !view.data.length)
        view.boxObject.invalidateRow(0);
    }, 2000, this);

    // Prevent a reference through closures
    boxObject = null;
  },

  get rowCount() {
    return (this.data && this.data.length ? this.data.length : 1);
  },

  getCellText: function(row, col) {
    if (typeof col != 'string')
      col = col.id;

    // Only two columns have text
    if (col != "type" && col != "address" && col != "filter")
      return "";

    if (this.data && this.data.length) {
      if (row >= this.data.length)
        return "";

      if (col == "type")
        return this.data[row].localizedDescr;
      else if (col == "filter")
        return (this.data[row].filter ? this.data[row].filter.text : "");
      else
        return this.data[row].location;
    }
    else {
      // Empty list, show dummy
      if (row > 0 || (col != "address" && col != "filter"))
        return "";

      if (!this.data)
        return (col == "address" ? this.loadDummy : "");

      var insecLocation = secureGet(window.content, "location");
      if (col == "filter") {
        var filter = abp.policy.isWhitelisted(secureGet(insecLocation, "href"));
        return filter ? filter.text : "";
      }

      // We want to stick with "no blockable items" for about:blank
      if (secureGet(insecLocation, "href") != "about:blank") {
        if (!abp.policy.isBlockableScheme(insecLocation))
          return this.remoteDummy;

        if (abp.policy.isWhitelisted(secureGet(insecLocation, "href")))
          return this.whitelistDummy;
      }

      return this.itemsDummy;
    }
  },

  getColumnProperties: function(col, properties) {
    if (typeof col != 'string')
      col = col.id;

    if (arguments.length == 3)
      properties = arguments[2];

    if ("col-" + col in this.atoms)
      properties.AppendElement(this.atoms["col-" + col]);
  },

  getRowProperties: function(row, properties) {
    if (row >= this.rowCount)
      return;

    properties.AppendElement(this.atoms["selected-" + this.selection.isSelected(row)]);

    var state;
    if (this.data && this.data.length) {
      properties.AppendElement(this.atoms["dummy-false"]);

      state = "state-regular";
      if (this.data[row].filter)
        state = (this.data[row].filter.type == "whitelist" ? "state-whitelisted" : "state-filtered");
    }
    else {
      properties.AppendElement(this.atoms["dummy-true"]);

      state = "state-filtered";
      if (this.data) {
        var insecLocation = secureGet(window.content, "location");
        if (abp.policy.isWhitelisted(secureGet(insecLocation, "href")))
          state = "state-whitelisted";
      }
    }
    properties.AppendElement(this.atoms[state]);
  },

  getCellProperties: function(row, col, properties)
  {
    this.getColumnProperties(col, properties);
    this.getRowProperties(row, properties);
  },

  cycleHeader: function(col) {
    if (typeof col != 'string')
      col = col.id;

    col = document.getElementById(col);
    if (!col)
      return;

    var cycle = {
      natural: 'ascending',
      ascending: 'descending',
      descending: 'natural'
    };

    var curDirection = "natural";
    if (this.sortColumn == col)
      curDirection = col.getAttribute("sortDirection");
    else if (this.sortColumn)
      this.sortColumn.removeAttribute("sortDirection");

    curDirection = cycle[curDirection];

    if (curDirection == "natural")
      this.sortProc = null;
    else
      this.sortProc = this.sortProcs[col.id + (curDirection == "descending" ? "Desc" : "")];

    if (this.data)
      this.refilter();

    col.setAttribute("sortDirection", curDirection);
    this.sortColumn = col;

    this.boxObject.invalidate();
  },

  isSorted: function() {
    return this.sortProc;
  },

  isContainer: function() {return false},
  isContainerOpen: function() {return false},
  isContainerEmpty: function() {return false},
  getLevel: function() {return 0},
  getParentIndex: function() {return -1},
  hasNextSibling: function() {return false},
  toggleOpenState: function() {},
  canDrop: function() {return false},
  canDropOn: function() {return false},
  canDropAfter: function() {return false},
  drop: function() {},
  getCellValue: function() {return null},
  getProgressMode: function() {return null},
  getImageSrc: function() {return null},
  isSeparator: function() {return false},
  isEditable: function() {return false},
  cycleCell: function() {},
  performAction: function() {},
  performActionOnRow: function() {},
  performActionOnCell: function() {},
  selection: null,
  selectionChanged: function() {},

  //
  // Custom properties and methods
  //

  boxObject: null,
  atoms: null,
  filter: "",
  data: null,
  allData: [],
  sortColumn: null,
  sortProc: null,
  itemsDummy: null,
  remoteDummy: null,
  whitelistDummy: null,
  itemsDummyTooltip: null,
  remoteDummyTooltip: null,
  whitelistDummyTooltip: null,
  loadDummy: null,

  sortProcs: {
    address: sortByAddress,
    addressDesc: sortByAddressDesc,
    type: createSortWithFallback(compareType, sortByAddress, false),
    typeDesc: createSortWithFallback(compareType, sortByAddress, true),
    filter: createSortWithFallback(compareFilter, sortByAddress, false),
    filterDesc: createSortWithFallback(compareFilter, sortByAddress, true),
    state: createSortWithFallback(compareState, sortByAddress, false),
    stateDesc: createSortWithFallback(compareState, sortByAddress, true)
  },

  setData: function(data) {
    var oldRows = this.rowCount;

    this.allData = data;
    this.refilter();

    this.boxObject.rowCountChanged(0, -oldRows);
    this.boxObject.rowCountChanged(0, this.rowCount);
  },

  addItem: function(item) {
    this.allData.push(item);
    if (this.filter && item.location.toLowerCase().indexOf(this.filter) < 0 && item.localizedDescr.toLowerCase().indexOf(this.filter) < 0)
      return;

    var index = -1;
    if (this.sortProc)
      for (var i = 0; index < 0 && i < this.data.length; i++)
        if (this.sortProc(item, this.data[i]) < 0)
          index = i;

    if (index >= 0)
      this.data.splice(index, 0, item);
    else {
      this.data.push(item);
      index = this.data.length - 1;
    }

    if (this.data.length == 1)
      this.boxObject.invalidateRow(0);
    else
      this.boxObject.rowCountChanged(index, 1);
  },

  refilter: function() {
    this.data = [];
    for (var i = 0; i < this.allData.length; i++)
      if (!this.filter || this.allData[i].location.toLowerCase().indexOf(this.filter) >= 0 || this.allData[i].localizedDescr.toLowerCase().indexOf(this.filter) >= 0)
        this.data.push(this.allData[i]);

    if (this.sortProc)
      this.data.sort(this.sortProc);
  },

  setFilter: function(filter) {
    var oldRows = this.rowCount;

    this.filter = filter.toLowerCase();
    this.refilter();

    var newRows = this.rowCount;
    if (oldRows != newRows)
      this.boxObject.rowCountChanged(oldRows < newRows ? oldRows : newRows, this.rowCount - oldRows);
    this.boxObject.invalidate();
  },

  getSelectedItem: function() {
    if (!this.data || this.selection.currentIndex < 0 || this.selection.currentIndex >= this.data.length)
      return null;

    return this.data[this.selection.currentIndex];
  },

  getItemAt: function(x, y) {
    if (!this.data)
      return null;

    var row = this.boxObject.getRowAt(x, y);
    if (row < 0 || row >= this.data.length)
      return null;

    return this.data[row];
  },

  getDummyTooltip: function() {
    if (!this.data || this.data.length)
      return null;

    var insecLocation = secureGet(window.content, "location");

    // We want to stick with "no blockable items" for about:blank
    if (secureGet(insecLocation, "href") != "about:blank") {
      if (!abp.policy.isBlockableScheme(insecLocation))
        return {tooltip: this.remoteDummyTooltip};

      var filter = abp.policy.isWhitelisted(secureGet(insecLocation, "href"));
      if (filter)
        return {tooltip: this.whitelistDummyTooltip, filter: filter};
    }

    return {tooltip: this.itemsDummyTooltip};
  },

  selectItem: function(item) {
    var row = -1;
    for (var i = 0; row < 0 && i < this.data.length; i++)
      if (this.data[i] == item)
        row = i;

    if (row < 0 )
      return;

    this.selection.select(row);
    this.boxObject.ensureRowIsVisible(row);
  }
}

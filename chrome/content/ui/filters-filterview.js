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
 * Portions created by the Initial Developer are Copyright (C) 2006-2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

Cu.import("resource://gre/modules/XPCOMUtils.jsm");

/**
 * nsITreeView implementation to display filters of a particular filter
 * subscription.
 * @class
 */
var FiltersView =
{
  /**
   * Initialization function.
   */
  init: function()
  {
    if (this.sortProcs)
      return;

    function compareText(/**Filter*/ filter1, /**Filter*/ filter2)
    {
      if (filter1.text < filter2.text)
        return -1;
      else if (filter1.text > filter2.text)
        return 1;
      else
        return 0;
    }
    function compareSlow(/**Filter*/ filter1, /**Filter*/ filter2)
    {
      let isSlow1 = filter1 instanceof RegExpFilter && defaultMatcher.isSlowFilter(filter1);
      let isSlow2 = filter2 instanceof RegExpFilter && defaultMatcher.isSlowFilter(filter2);
      return isSlow1 - isSlow2;
    }
    function compareEnabled(/**Filter*/ filter1, /**Filter*/ filter2)
    {
      let hasEnabled1 = (filter1 instanceof ActiveFilter ? 1 : 0);
      let hasEnabled2 = (filter2 instanceof ActiveFilter ? 1 : 0);
      if (hasEnabled1 != hasEnabled2)
        return hasEnabled1 - hasEnabled2;
      else if (hasEnabled1)
        return (filter2.disabled - filter1.disabled);
      else
        return 0;
    }
    function compareHitCount(/**Filter*/ filter1, /**Filter*/ filter2)
    {
      let hasHitCount1 = (filter1 instanceof ActiveFilter ? 1 : 0);
      let hasHitCount2 = (filter2 instanceof ActiveFilter ? 1 : 0);
      if (hasHitCount1 != hasHitCount2)
        return hasHitCount1 - hasHitCount2;
      else if (hasHitCount1)
        return filter1.hitCount - filter2.hitCount;
      else
        return 0;
    }
    function compareLastHit(/**Filter*/ filter1, /**Filter*/ filter2)
    {
      let hasLastHit1 = (filter1 instanceof ActiveFilter ? 1 : 0);
      let hasLastHit2 = (filter2 instanceof ActiveFilter ? 1 : 0);
      if (hasLastHit1 != hasLastHit2)
        return hasLastHit1 - hasLastHit2;
      else if (hasLastHit1)
        return filter1.lastHit - filter2.lastHit;
      else
        return 0;
    }

    /**
     * Creates a sort function from a primary and a secondary comparison function.
     * @param {Function} cmpFunc  comparison function to be called first
     * @param {Function} fallbackFunc  (optional) comparison function to be called if primary function returns 0
     * @param {Boolean} desc  if true, the result of the primary function (not the secondary function) will be reversed - sorting in descending order
     * @result {Function} comparison function to be used
     */
    function createSortFunction(cmpFunc, fallbackFunc, desc)
    {
      let factor = (desc ? -1 : 1);

      return function(entry1, entry2)
      {
        // Comment replacements not bound to a filter always go last
        let isLast1 = ("origFilter" in entry1 && entry1.filter == null);
        let isLast2 = ("origFilter" in entry2 && entry2.filter == null);
        if (isLast1)
          return (isLast2 ? 0 : 1)
        else if (isLast2)
          return -1;

        let ret = cmpFunc(entry1.filter, entry2.filter);
        if (ret == 0 && fallbackFunc)
          return fallbackFunc(entry1.filter, entry2.filter);
        else
          return factor * ret;
      }
    }

    this.sortProcs = {
      filter: createSortFunction(compareText, null, false),
      filterDesc: createSortFunction(compareText, null, true),
      slow: createSortFunction(compareSlow, compareText, true),
      slowDesc: createSortFunction(compareSlow, compareText, false),
      enabled: createSortFunction(compareEnabled, compareText, false),
      enabledDesc: createSortFunction(compareEnabled, compareText, true),
      hitcount: createSortFunction(compareHitCount, compareText, false),
      hitcountDesc: createSortFunction(compareHitCount, compareText, true),
      lasthit: createSortFunction(compareLastHit, compareText, false),
      lasthitDesc: createSortFunction(compareLastHit, compareText, true)
    };

    let me = this;
    let proxy = function()
    {
      return me._onChange.apply(me, arguments);
    };
    FilterNotifier.addListener(proxy);
    window.addEventListener("unload", function()
    {
      FilterNotifier.removeListener(proxy);
    }, false);
  },

  /**
   * Filter change processing.
   * @see FilterNotifier.addListener()
   */
  _onChange: function(action, item, param1, param2, param3)
  {
    switch (action)
    {
      case "filter.disabled":
      {
        this.updateFilter(item);
        break;
      }
      case "filter.added":
      {
        let subscription = param1;
        let position = param2;
        if (subscription == this._subscription)
          this.addFilterAt(position, item);
        break;
      }
      case "filter.removed":
      {
        let subscription = param1;
        let position = param2;
        if (subscription == this._subscription)
          this.removeFilterAt(position);
        break;
      }
      case "filter.moved":
      {
        let subscription = param1;
        let oldPosition = param2;
        let newPosition = param3;
        if (subscription == this._subscription)
          this.moveFilterAt(oldPosition, newPosition);
        break;
      }
    }
  },

  /**
   * Box object of the tree that this view is attached to.
   * @type nsITreeBoxObject
   */
  boxObject: null,

  /**
   * <tree> element that the view is attached to.
   * @type XULElement
   */
  get treeElement() this.boxObject ? this.boxObject.treeBody.parentNode : null,

  /**
   * Map of used cell properties to the corresponding nsIAtom representations.
   */
  atoms: null,

  /**
   * "Filter" to be displayed if no filter group is selected.
   */
  noGroupDummy: null,

  /**
   * "Filter" to be displayed if the selected group is empty.
   */
  noFiltersDummy: null,

  /**
   * "Filter" to be displayed for a new filter being edited.
   */
  editDummy: null,

  /**
   * Displayed list of filters, might be sorted.
   * @type Filter[]
   */
  data: [],

  /**
   * Tests whether the tree is currently visible.
   */
  get visible()
  {
    return this.boxObject && !this.treeElement.collapsed;
  },

  /**
   * Tests whether the tree is currently focused.
   * @type Boolean
   */
  get focused()
  {
    let focused = document.commandDispatcher.focusedElement;
    while (focused)
    {
      if ("treeBoxObject" in focused && focused.treeBoxObject == this.boxObject)
        return true;
      focused = focused.parentNode;
    }
    return false;
  },

  /**
   * Checks whether the list is currently empty (regardless of dummy entries).
   * @type Boolean
   */
  get isEmpty()
  {
    return !this._subscription || !this._subscription.filters.length;
  },

  /**
   * Returns items that are currently selected in the list.
   * @type Object[]
   */
  get selectedItems()
  {
    let items = []
    let oldIndex = this.selection.currentIndex;
    for (let i = 0; i < this.selection.getRangeCount(); i++)
    {
      let min = {};
      let max = {};
      this.selection.getRangeAt(i, min, max);
      for (let j = min.value; j <= max.value; j++)
        if (j >= 0 && j < this.data.length)
          items.push(this.data[j]);
    }
    return items;
  },

  _subscription: 0,

  /**
   * Filter subscription being displayed.
   * @type Subscription
   */
  get subscription() this._subscription,
  set subscription(value)
  {
    if (value == this._subscription)
      return;

    this._subscription = value;
    if (this.visible)
      this.refresh();
  },

  /**
   * Updates internal view data after a filter subscription change.
   */
  refresh: function()
  {
    let oldCount = this.rowCount;
    this.updateData();

    this.boxObject.rowCountChanged(0, -oldCount);
    this.boxObject.rowCountChanged(0, this.rowCount);
    if (this.rowCount)
      this.selection.select(0);
  },

  /**
   * Map of comparison functions by column ID  or column ID + "Desc" for
   * descending sort order.
   * @const
   */
  sortProcs: null,

  /**
   * Column that the list is currently sorted on.
   * @type Element
   */
  sortColumn: null,

  /**
   * Sorting function currently in use.
   * @type Function
   */
  sortProc: null,

  /**
   * Resorts the list.
   * @param {String} col ID of the column to sort on. If null, the natural order is restored.
   * @param {String} direction "ascending" or "descending", if null the sort order is toggled.
   */
  sortBy: function(col, direction)
  {
    let newSortColumn = null;
    if (col)
    {
      newSortColumn = this.boxObject.columns.getNamedColumn(col).element;
      if (!direction)
      {
        if (this.sortColumn == newSortColumn)
          direction = (newSortColumn.getAttribute("sortDirection") == "ascending" ? "descending" : "ascending");
        else
          direction = "ascending";
      }
    }

    if (this.sortColumn && this.sortColumn != newSortColumn)
      this.sortColumn.removeAttribute("sortDirection");

    this.sortColumn = newSortColumn;
    if (this.sortColumn)
    {
      this.sortColumn.setAttribute("sortDirection", direction);
      this.sortProc = this.sortProcs[col.replace(/^col-/, "") + (direction == "descending" ? "Desc" : "")];
    }
    else
      this.sortProc = null;

    if (this.data.length > 1)
    {
      this.updateData();
      this.boxObject.invalidate();
    }
  },

  /**
   * Changes sort current order for the tree. Sorts by filter column if the list is unsorted.
   * @param {String} order  either "ascending" or "descending"
   */
  setSortOrder: function(sortOrder)
  {
    let col = (this.sortColumn ? this.sortColumn.id : "col-filter");
    this.sortBy(col, sortOrder);
  },

  /**
   * Toggles the visibility of a tree column.
   */
  toggleColumn: function(/**String*/ id)
  {
    let col = E(id);
    col.setAttribute("hidden", col.hidden ? "false" : "true");
  },

  /**
   * Enables or disables all filters in the current selection.
   */
  selectionToggleDisabled: function()
  {
    let items = this.selectedItems.filter(function(i) i.filter instanceof ActiveFilter);
    if (items.length)
    {
      this.boxObject.beginUpdateBatch();
      let newValue = !items[0].filter.disabled;
      for (let i = 0; i < items.length; i++)
        items[i].filter.disabled = newValue;
      this.boxObject.endUpdateBatch();
    }
  },

  /**
   * Selects all entries in the list.
   */
  selectAll: function()
  {
    this.selection.selectAll();
  },

  /**
   * Starts editing the current filter.
   */
  startEditing: function()
  {
    this.treeElement.startEditing(this.selection.currentIndex, this.boxObject.columns.getNamedColumn("col-filter"));
  },

  /**
   * Starts editing a new filter at the current position.
   */
  insertFilter: function()
  {
    if (!(this._subscription instanceof SpecialSubscription))
      return;

    let position = this.selection.currentIndex;
    if (position < 0)
      position = 0;
    if (position >= this.data.length)
      position = this.data.length - 1;

    if (this.isEmpty && this.data.length)
    {
      this.data.splice(0, 1);
      this.boxObject.rowCountChanged(0, -1);
    }

    this.editDummy.index = (position < this.data.length ? this.data[position].index : Math.max(this.data.length - 1, 0));
    this.data.splice(position, 0, this.editDummy);
    this.boxObject.rowCountChanged(position, 1);
    this.selection.currentIndex = position;
    this.boxObject.ensureRowIsVisible(position);
    this.startEditing();

    let origIndex = this.selection.currentIndex;
    let tree = this.treeElement;
    let me = this;
    let listener = function(event)
    {
      if (event.attrName == "editing" && tree.editingRow < 0)
      {
        tree.removeEventListener("DOMAttrModified", listener, false);
        if (me.data[position] == me.editDummy)
        {
          me.data.splice(position, 1);
          me.boxObject.rowCountChanged(position, -1);
          me.selection.currentIndex = origIndex;

          if (me.data.length == 0)
          {
            me.updateData();
            me.boxObject.rowCountChanged(0, me.data.length);
            me.selection.select(0);
          }
        }
      }
    }
    tree.addEventListener("DOMAttrModified", listener, false);
  },

  /**
   * Deletes selected filters.
   */
  deleteSelected: function()
  {
    if (!(this._subscription instanceof SpecialSubscription))
      return;

    let oldIndex = this.selection.currentIndex;
    let items = this.selectedItems;
    items.sort(function(entry1, entry2) entry2.index - entry1.index);

    if (items.length == 0 || (items.length >= 2 && !Utils.confirm(window, this.treeElement.getAttribute("_removewarning"))))
      return;

    for (let i = 0; i < items.length; i++)
      FilterStorage.removeFilter(items[i].filter, this._subscription, items[i].index);

    if (oldIndex >= this.data.length)
      oldIndex = this.data.length - 1;
    this.selection.select(oldIndex);
    this.boxObject.ensureRowIsVisible(oldIndex);
  },

  /**
   * Moves selected filters one line up.
   */
  moveUp: function()
  {
    if (!(this._subscription instanceof SpecialSubscription) || this.isEmpty || this.sortProc)
      return;

    let items = this.selectedItems;
    if (!items.length)
      return;

    let newPos = items[0].index - 1;
    if (newPos < 0)
      return;

    items.sort(function(entry1, entry2) entry1.index - entry2.index);
    for (let i = 0; i < items.length; i++)
      FilterStorage.moveFilter(items[i].filter, this._subscription, items[i].index, newPos++);
    this.selection.rangedSelect(newPos - items.length, newPos - 1, false);
  },

  /**
   * Moves selected filters one line down.
   */
  moveDown: function()
  {
    if (!(this._subscription instanceof SpecialSubscription) || this.isEmpty || this.sortProc)
      return;

    let items = this.selectedItems;
    if (!items.length)
      return;

    let newPos = items[items.length - 1].index + 1;
    if (newPos >= this.data.length)
      return;

    items.sort(function(entry1, entry2) entry1.index - entry2.index);
    for (let i = items.length - 1; i >= 0; i--)
      FilterStorage.moveFilter(items[i].filter, this._subscription, items[i].index, newPos--);
    this.selection.rangedSelect(newPos + 1, newPos + items.length, false);
  },

  /**
   * Updates value of data property on sorting or filter subscription changes.
   */
  updateData: function()
  {
    if (this._subscription && this._subscription.filters.length)
    {
      this.data = this._subscription.filters.map(function(f, i) ({index: i, filter: f}));
      if (this.sortProc)
      {
        // Hide comments in the list, they should be sorted like the filter following them
        let followingFilter = null;
        for (let i = this.data.length - 1; i >= 0; i--)
        {
          if (this.data[i].filter instanceof CommentFilter)
          {
            this.data[i].origFilter = this.data[i].filter;
            this.data[i].filter = followingFilter;
          }
          else
            followingFilter = this.data[i].filter;
        }

        this.data.sort(this.sortProc);

        // Restore comments
        for (let i = 0; i < this.data.length; i++)
        {
          if ("origFilter" in this.data[i])
          {
            this.data[i].filter = this.data[i].origFilter;
            delete this.data[i].origFilter;
          }
        }
      }
    }
    else if (this._subscription)
      this.data = [this.noFiltersDummy]
    else
      this.data = [this.noGroupDummy];
  },

  /**
   * Called to update the view when a filter property is changed.
   */
  updateFilter: function(/**Filter*/ filter)
  {
    for (let i = 0; i < this.data.length; i++)
      if (this.data[i].filter == filter)
        this.boxObject.invalidateRow(i);
  },

  /**
   * Called if a filter has been inserted at the specified position.
   */
  addFilterAt: function(/**Integer*/ position, /**Filter*/ filter)
  {
    if (this.data.length == 1 && this.data[0].filter.dummy)
    {
      this.data.splice(0, 1);
      this.boxObject.rowCountChanged(0, -1);
    }

    if (this.sortProc)
    {
      this.updateData();
      for (let i = 0; i < this.data.length; i++)
      {
        if (this.data[i].index == position)
        {
          position = i;
          break;
        }
      }
    }
    else
    {
      for (let i = 0; i < this.data.length; i++)
        if (this.data[i].index >= position)
          this.data[i].index++;
      this.data.splice(position, 0, {index: position, filter: filter});
    }
    this.boxObject.rowCountChanged(position, 1);
    this.selection.select(position);
    this.boxObject.ensureRowIsVisible(position);
  },

  /**
   * Called if a filter has been removed at the specified position.
   */
  removeFilterAt: function(/**Integer*/ position)
  {
    if (this.isEmpty)
    {
      this.updateData();
      this.boxObject.invalidate();
      this.selection.select(0);
    }
    else
    {
      for (let i = 0; i < this.data.length; i++)
      {
        if (this.data[i].index == position)
        {
          this.data.splice(i, 1);
          this.boxObject.rowCountChanged(i, -1);
          i--;
        }
        else if (this.data[i].index > position)
          this.data[i].index--;
      }
    }
  },

  /**
   * Called if a filter has been moved within the list.
   */
  moveFilterAt: function(/**Integer*/ oldPosition, /**Integer*/ newPosition)
  {
    let dir = (oldPosition < newPosition ? 1 : -1);
    for (let i = 0; i < this.data.length; i++)
    {
      if (this.data[i].index == oldPosition)
        this.data[i].index = newPosition;
      else if (dir * this.data[i].index > dir * oldPosition && dir * this.data[i].index <= dir * newPosition)
        this.data[i].index -= dir;
    }

    if (!this.sortProc)
    {
      let item = this.data[oldPosition];
      this.data.splice(oldPosition, 1);
      this.data.splice(newPosition, 0, item);
      this.boxObject.invalidateRange(Math.min(oldPosition, newPosition), Math.max(oldPosition, newPosition));
    }
  },

  /**
   * Fills the context menu of the filters columns.
   */
  fillColumnPopup: function()
  {
    E("filters-view-filter").setAttribute("checked", !E("col-filter").hidden);
    E("filters-view-slow").setAttribute("checked", !E("col-slow").hidden);
    E("filters-view-enabled").setAttribute("checked", !E("col-enabled").hidden);
    E("filters-view-hitcount").setAttribute("checked", !E("col-hitcount").hidden);
    E("filters-view-lasthit").setAttribute("checked", !E("col-lasthit").hidden);

    let sortColumn = this.sortColumn;
    let sortColumnID = (sortColumn ? sortColumn.id : null);
    let sortDir = (sortColumn ? sortColumn.getAttribute("sortDirection") : "natural");
    E("filters-sort-none").setAttribute("checked", sortColumn == null);
    E("filters-sort-filter").setAttribute("checked", sortColumnID == "col-filter");
    E("filters-sort-enabled").setAttribute("checked", sortColumnID == "col-enabled");
    E("filters-sort-hitcount").setAttribute("checked", sortColumnID == "col-hitcount");
    E("filters-sort-lasthit").setAttribute("checked", sortColumnID == "col-lasthit");
    E("filters-sort-asc").setAttribute("checked", sortDir == "ascending");
    E("filters-sort-desc").setAttribute("checked", sortDir == "descending");
  },

  /**
   * Called whenever a key is pressed on the list.
   */
  keyPress: function(/**Event*/ event)
  {
    let modifiers = 0;
    if (event.altKey)
      modifiers |= SubscriptionActions._altMask;
    if (event.ctrlKey)
      modifiers |= SubscriptionActions._ctrlMask;
    if (event.metaKey)
      modifiers |= SubscriptionActions._metaMask;

    if (event.charCode == " ".charCodeAt(0) && modifiers == 0 && !E("col-enabled").hidden)
      this.selectionToggleDisabled();
    else if (event.keyCode == Ci.nsIDOMKeyEvent.DOM_VK_UP && modifiers == SubscriptionActions._accelMask)
    {
      E("filters-moveUp-command").doCommand();
      event.preventDefault();
      event.stopPropagation();
    }
    else if (event.keyCode == Ci.nsIDOMKeyEvent.DOM_VK_DOWN && modifiers == SubscriptionActions._accelMask)
    {
      E("filters-moveDown-command").doCommand();
      event.preventDefault();
      event.stopPropagation();
    }
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsITreeView]),

  setTree: function(boxObject)
  {
    this.init();
    this.boxObject = boxObject;

    if (this.boxObject)
    {
      this.noGroupDummy = {index: 0, filter: {text: this.boxObject.treeBody.getAttribute("noGroupText"), dummy: true}};
      this.noFiltersDummy = {index: 0, filter: {text: this.boxObject.treeBody.getAttribute("noFiltersText"), dummy: true}};
      this.editDummy = {filter: {text: ""}};

      let atomService = Cc["@mozilla.org/atom-service;1"].getService(Ci.nsIAtomService);
      let stringAtoms = ["col-filter", "col-enabled", "col-hitcount", "col-lasthit", "type-comment", "type-filterlist", "type-whitelist", "type-elemhide", "type-invalid"];
      let boolAtoms = ["selected", "dummy", "slow", "disabled"];

      this.atoms = {};
      for each (let atom in stringAtoms)
        this.atoms[atom] = atomService.getAtom(atom);
      for each (let atom in boolAtoms)
      {
        this.atoms[atom + "-true"] = atomService.getAtom(atom + "-true");
        this.atoms[atom + "-false"] = atomService.getAtom(atom + "-false");
      }

      let columns = this.boxObject.columns;
      for (let i = 0; i < columns.length; i++)
        if (columns[i].element.hasAttribute("sortDirection"))
          this.sortBy(columns[i].id, columns[i].element.getAttribute("sortDirection"));

      this.treeElement.parentNode.addEventListener("keypress", function(event)
      {
        FiltersView.keyPress(event);
      }, true);
    }
  },

  selection: null,

  get rowCount() this.data.length,

  getCellText: function(row, col)
  {
    if (row < 0 || row >= this.data.length)
      return null;

    col = col.id;
    if (col != "col-filter" && col != "col-slow" && col != "col-hitcount" && col != "col-lasthit")
      return null;

    let filter = this.data[row].filter;
    if (col == "col-filter")
      return filter.text;
    else if (col == "col-slow")
      return (filter instanceof RegExpFilter && defaultMatcher.isSlowFilter(filter) ? "!" : null);
    else if (filter instanceof ActiveFilter)
    {
      if (col == "col-hitcount")
        return filter.hitCount;
      else if (col == "col-lasthit")
        return (filter.lastHit ? Utils.formatTime(filter.lastHit) : null);
    }
    else
      return null;
  },

  getColumnProperties: function(col, properties)
  {
    col = col.id;

    if (col in this.atoms)
      properties.AppendElement(this.atoms[col]);
  },

  getRowProperties: function(row, properties)
  {
    if (row < 0 || row >= this.data.length)
      return;

    let filter = this.data[row].filter;
    properties.AppendElement(this.atoms["selected-" + this.selection.isSelected(row)]);
    properties.AppendElement(this.atoms["slow-" + (filter instanceof RegExpFilter && defaultMatcher.isSlowFilter(filter))]);
    if (filter instanceof ActiveFilter)
      properties.AppendElement(this.atoms["disabled-" + filter.disabled]);
    properties.AppendElement(this.atoms["dummy-" + ("dummy" in filter)]);

    if (filter instanceof CommentFilter)
      properties.AppendElement(this.atoms["type-comment"]);
    else if (filter instanceof BlockingFilter)
      properties.AppendElement(this.atoms["type-filterlist"]);
    else if (filter instanceof WhitelistFilter)
      properties.AppendElement(this.atoms["type-whitelist"]);
    else if (filter instanceof ElemHideFilter)
      properties.AppendElement(this.atoms["type-elemhide"]);
    else if (filter instanceof InvalidFilter)
      properties.AppendElement(this.atoms["type-invalid"]);
  },

  getCellProperties: function(row, col, properties)
  {
    this.getColumnProperties(col, properties);
    this.getRowProperties(row, properties);
  },

  cycleHeader: function(col)
  {
    let oldDirection = col.element.getAttribute("sortDirection");
    if (oldDirection == "ascending")
      this.sortBy(col.id, "descending");
    else if (oldDirection == "descending")
      this.sortBy(null, null);
    else
      this.sortBy(col.id, "ascending");
  },

  isSorted: function()
  {
    return (this.sortProc != null);
  },

  canDrop: function(row, orientation)
  {
    // TODO
    return false;
  },

  drop: function(row, orientation)
  {
    // TODO
  },

  isEditable: function(row, col)
  {
    if (row < 0 || row >= this.data.length)
      return false;
    if (!(this._subscription instanceof SpecialSubscription))
      return false;

    let filter = this.data[row].filter;
    if (col.id == "col-filter")
      return !("dummy" in filter);
    else
      return false;
  },

  setCellText: function(row, col, value)
  {
    if (row < 0 || row >= this.data.length || col.id != "col-filter")
      return;

    let oldFilter = this.data[row].filter;
    let position = this.data[row].index;
    value = Filter.normalize(value);
    if (!value || value == oldFilter.text)
      return;

    let newFilter = Filter.fromText(value);
    if (this.data[row] == this.editDummy)
    {
      this.data.splice(row, 1);
      this.boxObject.rowCountChanged(row, -1);
    }
    else
      FilterStorage.removeFilter(oldFilter, this._subscription, position);
    FilterStorage.addFilter(newFilter, this._subscription, position);
  },

  cycleCell: function(row, col)
  {
    if (row < 0 || row >= this.data.length || col.id != "col-enabled")
      return null;

    let filter = this.data[row].filter;
    if (filter instanceof ActiveFilter)
      filter.disabled = !filter.disabled;
  },

  isContainer: function(row) false,
  isContainerOpen: function(row) false,
  isContainerEmpty: function(row) true,
  getLevel: function(row) 0,
  getParentIndex: function(row) -1,
  hasNextSibling: function(row, afterRow) false,
  toggleOpenState: function(row) {},
  getProgressMode: function() null,
  getImageSrc: function() null,
  isSeparator: function() false,
  performAction: function() {},
  performActionOnRow: function() {},
  performActionOnCell: function() {},
  getCellValue: function() null,
  setCellValue: function() {},
  selectionChanged: function() {},
};

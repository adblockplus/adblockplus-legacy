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

/**
 * Implementation of the various actions performed on the filters.
 * @class
 */
var FilterActions =
{
  /**
   * Initializes filter actions.
   */
  init: function()
  {
    let me = this;
    this.treeElement.parentNode.addEventListener("keypress", function(event)
    {
      me.keyPress(event);
    }, true);
    this.treeElement.view = FilterView;
  },

  /**
   * <tree> element containing the filters.
   * @type XULElement
   */
  get treeElement() E("filtersTree"),

  /**
   * Tests whether the tree is currently visible.
   */
  get visible()
  {
    return !this.treeElement.collapsed;
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
      if ("treeBoxObject" in focused && focused.treeBoxObject == FilterView.boxObject)
        return true;
      focused = focused.parentNode;
    }
    return false;
  },

  /**
   * Changes sort current order for the tree. Sorts by filter column if the list is unsorted.
   * @param {String} order  either "ascending" or "descending"
   */
  setSortOrder: function(sortOrder)
  {
    let col = (FilterView.sortColumn ? FilterView.sortColumn.id : "col-filter");
    FilterView.sortBy(col, sortOrder);
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
    if (this.treeElement.editingColumn)
      return;

    let items = FilterView.selectedItems.filter(function(i) i.filter instanceof ActiveFilter);
    if (items.length)
    {
      FilterView.boxObject.beginUpdateBatch();
      let newValue = !items[0].filter.disabled;
      for (let i = 0; i < items.length; i++)
        items[i].filter.disabled = newValue;
      FilterView.boxObject.endUpdateBatch();
    }
  },

  /**
   * Selects all entries in the list.
   */
  selectAll: function()
  {
    if (this.treeElement.editingColumn)
      return;

    FilterView.selection.selectAll();
  },

  /**
   * Starts editing the current filter.
   */
  startEditing: function()
  {
    if (this.treeElement.editingColumn)
      return;

    this.treeElement.startEditing(FilterView.selection.currentIndex, FilterView.boxObject.columns.getNamedColumn("col-filter"));
  },

  /**
   * Starts editing a new filter at the current position.
   */
  insertFilter: function()
  {
    if (!FilterView.editable || this.treeElement.editingColumn)
      return;

    FilterView.insertEditDummy();
    this.startEditing();

    let tree = this.treeElement;
    let listener = function(event)
    {
      if (event.attrName == "editing" && tree.editingRow < 0)
      {
        tree.removeEventListener("DOMAttrModified", listener, false);
        FilterView.removeEditDummy();
      }
    }
    tree.addEventListener("DOMAttrModified", listener, false);
  },

  /**
   * Deletes selected filters.
   */
  deleteSelected: function()
  {
    if (!FilterView.editable || this.treeElement.editingColumn)
      return;

    let oldIndex = FilterView.selection.currentIndex;
    let items = FilterView.selectedItems;
    items.sort(function(entry1, entry2) entry2.index - entry1.index);

    if (items.length == 0 || (items.length >= 2 && !Utils.confirm(window, this.treeElement.getAttribute("_removewarning"))))
      return;

    for (let i = 0; i < items.length; i++)
      FilterStorage.removeFilter(items[i].filter, FilterView._subscription, items[i].index);

    FilterView.selectRow(oldIndex);
  },

  /**
   * Moves items to a different position in the list.
   * @param {Array} items
   * @param {Integer} offset  negative offsets move the items up, positive down
   */
  _moveItems: function(/**Array*/ items, /**Integer*/ offset)
  {
    if (!items.length)
      return;

    if (offset < 0)
    {
      items.sort(function(entry1, entry2) entry1.index - entry2.index);
      let position = items[0].index + offset;
      if (position < 0)
        return;

      for (let i = 0; i < items.length; i++)
        FilterStorage.moveFilter(items[i].filter, FilterView._subscription, items[i].index, position++);
      FilterView.selection.rangedSelect(position - items.length, position - 1, false);
    }
    else if (offset > 0)
    {
      items.sort(function(entry1, entry2) entry2.index - entry1.index);
      let position = items[0].index + offset;
      if (position >= FilterView.rowCount)
        return;

      for (let i = 0; i < items.length; i++)
        FilterStorage.moveFilter(items[i].filter, FilterView._subscription, items[i].index, position--);
      FilterView.selection.rangedSelect(position + 1, position + items.length, false);
    }
  },

  /**
   * Moves selected filters one line up.
   */
  moveUp: function()
  {
    if (!FilterView.editable || FilterView.isEmpty || FilterView.isSorted() || this.treeElement.editingColumn)
      return;

    this._moveItems(FilterView.selectedItems, -1);
  },

  /**
   * Moves selected filters one line down.
   */
  moveDown: function()
  {
    if (!FilterView.editable || FilterView.isEmpty || FilterView.isSorted() || this.treeElement.editingColumn)
      return;

    this._moveItems(FilterView.selectedItems, 1);
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

    let sortColumn = FilterView.sortColumn;
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

  dragItems: null,

  /**
   * Called whenever the user starts a drag operation.
   */
  startDrag: function(/**Event*/ event)
  {
    if (!FilterView.editable || FilterView.isEmpty || FilterView.isSorted() || this.treeElement.editingColumn)
      return false;

    let items = FilterView.selectedItems;
    if (!items.length)
      return;

    items.sort(function(entry1, entry2) entry1.index - entry2.index);
    event.dataTransfer.setData("text/plain", items.map(function(i) i.filter.text).join("\n"));
    this.dragItems = items;
    event.stopPropagation();
  },

  /**
   * Called to check whether moving the items to the given position is possible.
   */
  canDrop: function(/**Integer*/ newPosition, /**nsIDOMDataTransfer*/ dataTransfer)
  {
    if (!this.dragItems)
    {
      if (!FilterView.editable || this.treeElement.editingColumn)
        return false;

      return dataTransfer && dataTransfer.getData("text/plain");
    }
    if (newPosition < this.dragItems[0].index)
      return true;
    else if (newPosition > this.dragItems[this.dragItems.length - 1].index + 1)
      return true;
    else
      return false;
  },

  /**
   * Called when the user decides to drop the items.
   */
  drop: function(/**Integer*/ newPosition, /**nsIDOMDataTransfer*/ dataTransfer)
  {
    if (!this.dragItems)
    {
      if (!FilterView.editable || this.treeElement.editingColumn)
        return;

      let data = (dataTransfer ? dataTransfer.getData("text/plain") : null);
      if (data)
      {
        let lines = data.replace(/\r/g, "").split("\n");
        for (let i = 0; i < lines.length; i++)
        {
          let filter = Filter.fromText(lines[i]);
          if (filter)
            FilterStorage.addFilter(filter, FilterView._subscription, newPosition++);
        }
      }
      return;
    }
    if (newPosition < this.dragItems[0].index)
      this._moveItems(this.dragItems, newPosition - this.dragItems[0].index);
    else if (newPosition > this.dragItems[this.dragItems.length - 1].index + 1)
      this._moveItems(this.dragItems, newPosition - this.dragItems[this.dragItems.length - 1].index - 1);
  },

  /**
   * Called whenever the a drag operation finishes.
   */
  endDrag: function(/**Event*/ event)
  {
    this.dragItems = null;
  }
};

window.addEventListener("load", function()
{
  FilterActions.init();
}, false);

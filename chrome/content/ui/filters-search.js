/*
 * This file is part of Adblock Plus <https://adblockplus.org/>,
 * Copyright (C) 2006-2016 Eyeo GmbH
 *
 * Adblock Plus is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * Adblock Plus is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Adblock Plus.  If not, see <http://www.gnu.org/licenses/>.
 */

/**
 * Implementation of the filter search functionality.
 * @class
 */
var FilterSearch =
{
  lastSearchString: null,

  /**
   * Handles keypress events on the findbar widget.
   */
  keyPress: function(/**Event*/ event)
  {
    if (event.keyCode == KeyEvent.DOM_VK_RETURN)
      event.preventDefault();
    else if (event.keyCode == KeyEvent.DOM_VK_ESCAPE)
    {
      event.preventDefault();
      this.close();
    }
    else if (event.keyCode == KeyEvent.DOM_VK_UP)
    {
      event.preventDefault();
      this.search(-1);
    }
    else if (event.keyCode == KeyEvent.DOM_VK_DOWN)
    {
      event.preventDefault();
      this.search(1);
    }
    else if (event.keyCode == KeyEvent.DOM_VK_PAGE_UP)
    {
      event.preventDefault();
      E("filtersTree").treeBoxObject.scrollByPages(-1);
    }
    else if (event.keyCode == KeyEvent.DOM_VK_PAGE_DOWN)
    {
      event.preventDefault();
      E("filtersTree").treeBoxObject.scrollByPages(1);
    }
  },

  /**
   * Makes the find bar visible and focuses it.
   */
  open: function()
  {
    E("findbar").hidden = false;
    E("findbar-textbox").focus();
  },

  /**
   * Closes the find bar.
   */
  close: function()
  {
    E("findbar").hidden = true;
  },

  /**
   * Performs a filter search.
   * @param {Integer} [direction]
   *   See @link{FilterSearch#search}
   * @return {String}
   *   result status, one of "" (success), "notFound", "wrappedEnd",
   *   "wrappedStart"
   */
  _search: function(direction)
  {
    let text = E("findbar-textbox").value.trim();
    if (!text)
      return "";

    let caseSensitive = E("findbar-case-sensitive").checked;

    if (typeof direction == "undefined")
      direction = (text == this.lastSearchString ? 1 : 0);
    this.lastSearchString = text;

    let normalizeString = (caseSensitive ?
                           string => string :
                           string => string.toLowerCase());

    function findText(startIndex)
    {
      let list = E("filtersTree");
      let col = list.columns.getNamedColumn("col-filter");
      let count = list.view.rowCount;
      for (let i = startIndex + direction; i >= 0 && i < count; i += (direction || 1))
      {
        let filter = normalizeString(list.view.getCellText(i, col));
        if (filter.indexOf(text) >= 0)
        {
          FilterView.selectRow(i, true);
          return true;
        }
      }
      return false;
    }

    text = normalizeString(text);

    // First try to find the entry in the current list
    if (findText(E("filtersTree").currentIndex))
      return "";

    // Now go through the other subscriptions
    let result = "";
    let subscriptions = FilterStorage.subscriptions.slice();
    subscriptions.sort((s1, s2) => (s1 instanceof SpecialSubscription) - (s2 instanceof SpecialSubscription));
    let current = subscriptions.indexOf(FilterView.subscription);
    direction = direction || 1;
    for (let i = current + direction; ; i+= direction)
    {
      if (i < 0)
      {
        i = subscriptions.length - 1;
        result = "wrappedStart";
      }
      else if (i >= subscriptions.length)
      {
        i = 0;
        result = "wrappedEnd";
      }
      if (i == current)
        break;

      let subscription = subscriptions[i];
      for (let j = 0; j < subscription.filters.length; j++)
      {
        let filter = normalizeString(subscription.filters[j].text);
        if (filter.indexOf(text) >= 0)
        {
          let list = E(subscription instanceof SpecialSubscription ? "groups" : "subscriptions");
          let node = Templater.getNodeForData(list, "subscription", subscription);
          if (!node)
            break;

          // Select subscription in its list and restore focus after that
          let oldFocus = document.commandDispatcher.focusedElement;
          E("tabs").selectedIndex = (subscription instanceof SpecialSubscription ? 1 : 0);
          list.ensureElementIsVisible(node);
          list.selectItem(node);
          if (oldFocus)
          {
            oldFocus.focus();
            Utils.runAsync(() => oldFocus.focus());
          }

          Utils.runAsync(() => findText(direction == 1 ? -1 :  subscription.filters.length));
          return result;
        }
      }
    }

    return "notFound";
  },

  /**
   * Performs a filter search and displays the resulting search status.
   * @param {Integer} [direction]
   *   search direction: -1 (backwards), 0 (forwards starting with current),
   *   1 (forwards starting with next)
   */
  search: function(direction)
  {
    E("findbar").setAttribute("data-status", this._search(direction));
  }
};

window.addEventListener("load", event =>
{
  E("findbar").setAttribute("data-os", Services.appinfo.OS.toLowerCase());
});

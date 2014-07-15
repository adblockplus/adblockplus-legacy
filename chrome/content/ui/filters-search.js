/*
 * This file is part of Adblock Plus <http://adblockplus.org/>,
 * Copyright (C) 2006-2014 Eyeo GmbH
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
  /**
   * Initializes findbar widget.
   */
  init: function()
  {
    let findbar = E("findbar");
    findbar.browser = FilterSearch.fakeBrowser;

    findbar.addEventListener("keypress", function(event)
    {
      // Work-around for bug 490047
      if (event.keyCode == KeyEvent.DOM_VK_RETURN)
        event.preventDefault();
    }, false);

    // Hack to prevent "highlight all" from getting enabled
    findbar.toggleHighlight = function() {};
  },

  /**
   * Performs a text search.
   * @param {String} text  text to be searched
   * @param {Integer} direction  search direction: -1 (backwards), 0 (forwards
   *                  starting with current), 1 (forwards starting with next)
   * @param {Boolean} caseSensitive  if true, a case-sensitive search is performed
   * @result {Integer} one of the nsITypeAheadFind constants
   */
  search: function(text, direction, caseSensitive)
  {
    function normalizeString(string) caseSensitive ? string : string.toLowerCase();

    function findText(text, direction, startIndex)
    {
      let list = E("filtersTree");
      let col = list.columns.getNamedColumn("col-filter");
      let count = list.view.rowCount;
      for (let i = startIndex + direction; i >= 0 && i < count; i += (direction || 1))
      {
        let filter = normalizeString(list.view.getCellText(i, col));
        if (filter.indexOf(text) >= 0)
        {
          FilterView.selectRow(i);
          return true;
        }
      }
      return false;
    }

    text = normalizeString(text);

    // First try to find the entry in the current list
    if (findText(text, direction, E("filtersTree").currentIndex))
      return Ci.nsITypeAheadFind.FIND_FOUND;

    // Now go through the other subscriptions
    let result = Ci.nsITypeAheadFind.FIND_FOUND;
    let subscriptions = FilterStorage.subscriptions.slice();
    subscriptions.sort(function(s1, s2) (s1 instanceof SpecialSubscription) - (s2 instanceof SpecialSubscription));
    let current = subscriptions.indexOf(FilterView.subscription);
    direction = direction || 1;
    for (let i = current + direction; ; i+= direction)
    {
      if (i < 0)
      {
        i = subscriptions.length - 1;
        result = Ci.nsITypeAheadFind.FIND_WRAPPED;
      }
      else if (i >= subscriptions.length)
      {
        i = 0;
        result = Ci.nsITypeAheadFind.FIND_WRAPPED;
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
            Utils.runAsync(oldFocus.focus, oldFocus);
          }

          Utils.runAsync(findText, null, text, direction, direction == 1 ? -1 : subscription.filters.length);
          return result;
        }
      }
    }

    return Ci.nsITypeAheadFind.FIND_NOTFOUND;
  }
};

/**
 * Fake browser implementation to make findbar widget happy - searches in
 * the filter list.
 */
FilterSearch.fakeBrowser =
{
  finder:
  {
    _resultListeners: [],
    searchString: null,
    caseSensitive: false,
    lastResult: null,

    _notifyResultListeners: function(result, findBackwards)
    {
      this.lastResult = result;
      for (let listener of this._resultListeners)
      {
        // See https://bugzilla.mozilla.org/show_bug.cgi?id=958101, starting
        // with Gecko 29 only one parameter is expected.
        try
        {
          if (listener.onFindResult.length == 1)
          {
            listener.onFindResult({searchString: this.searchString,
                result: result, findBackwards: findBackwards});
          }
          else
            listener.onFindResult(result, findBackwards);
        }
        catch (e)
        {
          Cu.reportError(e);
        }
      }
    },

    fastFind: function(searchString, linksOnly, drawOutline)
    {
      this.searchString = searchString;
      let result = FilterSearch.search(this.searchString, 0,
                                       this.caseSensitive);
      this._notifyResultListeners(result, false);
    },

    findAgain: function(findBackwards, linksOnly, drawOutline)
    {
      let result = FilterSearch.search(this.searchString,
                                       findBackwards ? -1 : 1,
                                       this.caseSensitive);
      this._notifyResultListeners(result, findBackwards);
    },

    addResultListener: function(listener)
    {
      if (this._resultListeners.indexOf(listener) === -1)
        this._resultListeners.push(listener);
    },

    removeResultListener: function(listener)
    {
      let index = this._resultListeners.indexOf(listener);
      if (index !== -1)
        this._resultListeners.splice(index, 1);
    },

    // Irrelevant for us
    requestMatchesCount: function(searchString, matchLimit, linksOnly) {},
    highlight: function(highlight, word) {},
    enableSelection: function() {},
    removeSelection: function() {},
    focusContent: function() {},
    keyPress: function() {}
  },

  get _lastSearchString()
  {
    return this.finder.searchString;
  },

  // This was used before Firefox 27 instead of the "finder" property.
  fastFind:
  {
    get searchString()
    {
      return FilterSearch.fakeBrowser.finder.searchString;
    },

    set searchString(searchString)
    {
      FilterSearch.fakeBrowser.finder.searchString = searchString;
    },

    foundLink: null,
    foundEditable: null,

    get caseSensitive()
    {
      return FilterSearch.fakeBrowser.finder.caseSensitive;
    },

    set caseSensitive(caseSensitive)
    {
      FilterSearch.fakeBrowser.finder.caseSensitive = caseSensitive;
    },

    get currentWindow() FilterSearch.fakeBrowser.contentWindow,

    find: function(searchString, linksOnly)
    {
      FilterSearch.fakeBrowser.finder.fastFind(searchString, linksOnly);
      return FilterSearch.fakeBrowser.finder.lastResult;
    },

    findAgain: function(findBackwards, linksOnly)
    {
      FilterSearch.fakeBrowser.finder.findAgain(findBackwards, linksOnly);
      return FilterSearch.fakeBrowser.finder.lastResult;
    },

    // Irrelevant for us
    init: function() {},
    setDocShell: function() {},
    setSelectionModeAndRepaint: function() {},
    collapseSelection: function() {}
  },
  currentURI: Utils.makeURI("http://example.com/"),
  contentWindow:
  {
    focus: function()
    {
      E("filtersTree").focus();
    },
    scrollByLines: function(num)
    {
      E("filtersTree").boxObject.scrollByLines(num);
    },
    scrollByPages: function(num)
    {
      E("filtersTree").boxObject.scrollByPages(num);
    },
  },

  addEventListener: function(event, handler, capture)
  {
    E("filtersTree").addEventListener(event, handler, capture);
  },
  removeEventListener: function(event, handler, capture)
  {
    E("filtersTree").addEventListener(event, handler, capture);
  },
};

window.addEventListener("load", function()
{
  FilterSearch.init();
}, false);

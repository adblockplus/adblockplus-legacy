var _windowMediator = {
  hwndToWindow: {},
  recentTypes: {},
  getMostRecentWindow: function(type) {
    if (type == "navigator:browser")
      return window;
    else if (type in this.recentTypes && !this.recentTypes[type].closed)
      return this.recentTypes[type];
    else
      return null;
  },

  observe: function(wnd, topic, data) {
    if (topic == "domwindowopened") {
      if (wnd instanceof Components.interfaces.nsIDOMChromeWindow)
        addRootListener(wnd, "load", true);
      else {
        addRootListener(wnd, "focus", true);
        addRootListener(wnd, "contextmenu", true);
      }
    }
    else if (topic == "domwindowclosed") {
      var hWnd = this.toHWND(wnd);
      if (hWnd && hWnd in this.hwndToWindow)
        delete this.hwndToWindow[hWnd];
    }
  },

  processNewDialog: function(wnd) {
    if (wnd.location.protocol != "chrome:" || wnd.location.host != "adblockplus")
      return;

    removeRootListener(wnd, "load", true);

    var hWnd = this.toHWND(wnd);
    if (!hWnd)
      return;

    subclassDialogWindow(hWnd);

    this.hwndToWindow[hWnd] = wnd;
    this.hwndToWindow["move" + hWnd] = true;
    this.hwndToWindow["resize" + hWnd] = true;

    var oldFocus = wnd.focus;
    wnd.focus = function() {
      focusWindow(hWnd);
    };

    var root = wnd.document.documentElement;
    if (root.hasAttribute("windowtype"))
      this.recentTypes[root.getAttribute("windowtype")] = wnd;

    if (wnd.location.href.indexOf("settings.xul") >= 0) {
      try {
        wnd.document.getElementById("showintoolbar").hidden = true;
      }
      catch (e) {}
    }
    else if (wnd.location.href.indexOf("sidebarDetached.xul") >= 0)
      setTopmostWindow(hWnd);
  },

  toHWND: function(wnd) {
    try {
      return getHWND(_windowWatcher.getChromeForWindow(wnd)
                                   .QueryInterface(Components.interfaces.nsIEmbeddingSiteWindow));
    }
    catch (e) {
      return null;
    }
  },

  toWindow: function(hWnd) {
    if (hWnd in this.hwndToWindow)
      return this.hwndToWindow[hWnd];
    else
      return null;
  },

  shouldMove: function(hWnd) {
    if ("move" + hWnd in this.hwndToWindow) {
      delete this.hwndToWindow["move" + hWnd];
      return true;
    }
    else
      return false;
  },
  shouldResize: function(hWnd) {
    if ("resize" + hWnd in this.hwndToWindow) {
      delete this.hwndToWindow["resize" + hWnd];
      return true;
    }
    else
      return false;
  },

  openWindow: function(parent, url, target, features, args) {
    return openDialog(url, target, features);
  },

  QueryInterface: function(iid) {
    if (iid.equals(Components.interfaces.nsISupports) ||
        iid.equals(Components.interfaces.nsIObserver) ||
        iid.equals(Components.interfaces.nsIWindowMediator))
      return this;

    throw Components.results.NS_ERROR_NO_INTERFACE;
  }
};

var _windowWatcher = Components.classes["@mozilla.org/embedcomp/window-watcher;1"]
                               .getService(Components.interfaces.nsIWindowWatcher);
_windowWatcher.registerNotification(_windowMediator);
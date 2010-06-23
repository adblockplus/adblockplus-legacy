var window = this;

var location = {
  href: "chrome://browser/content/browser.xul"
}

var _loadListeners = [];
function addEventListener(event, handler, capture) {
  if (event == "load")
    _loadListeners.push(handler);
}
function removeEventListener(event, handler, capture) {
  if (event == "load")
    _loadListeners = _loadListeners.filter(function(item) {return item != handler});
}
function _notifyLoadListeners() {
  for (var i = 0; i < _loadListeners.length; i++)
    _loadListeners[i].call(window);
}

var _timers = {last: 0};
function setInterval(callback, delay) {
  var timer = Components.classes["@mozilla.org/timer;1"]
                        .createInstance(Components.interfaces.nsITimer);
  timer.init({observe: callback}, delay, Components.interfaces.nsITimer.TYPE_REPEATING_SLACK);
  _timers[++_timers.last] = timer;
}
function setTimeout(callback, delay) {
  var index = ++_timers.last;
  var timer = Components.classes["@mozilla.org/timer;1"]
                        .createInstance(Components.interfaces.nsITimer);
  timer.init({
    observe: function() {
      callback();
      delete _timers[index];
      timer = null;
    }
  }, delay, Components.interfaces.nsITimer.TYPE_ONE_SHOT);
  _timers[index] = timer;
}

function delayedOpenTab(url)
{
  var hWnd = (_currentWindow && !_currentWindow.closed ? _windowMediator.toHWND(_currentWindow) : null);
  openTab(url, hWnd);
}

function QueryInterface(iid) {
  if (iid.equals(Components.interfaces.nsISupports) ||
      iid.equals(Components.interfaces.nsIDOMWindow) ||
      iid.equals(Components.interfaces.nsIDOMWindowInternal))
    return this;

  if (iid.equals(Components.interfaces.nsIClassInfo))
    return _classInfo;

  throw Components.results.NS_ERROR_NO_INTERFACE;
}

var _classInfo = {
  get contractID() {throw Components.results.NS_ERROR_NOT_AVAILABLE},
  get classDescription() {throw Components.results.NS_ERROR_NOT_AVAILABLE},
  get classID() {throw Components.results.NS_ERROR_NOT_AVAILABLE},
  implementationLanguage: Components.interfaces.nsIProgrammingLanguage.JAVASCRIPT,
  flags: Components.interfaces.nsIClassInfoMAIN_THREAD_ONLY | Components.interfaces.nsIClassInfo.DOM_OBJECT,
  getHelperForLanguage: function() {return window.scriptable},
  getInterfaces: function(count, array) {
    count.value = 0;
    return [];
  },
  QueryInterface: window.QueryInterface
}

this.__defineGetter__("content", function() {
  return (_currentWindow && !_currentWindow.closed ? _currentWindow : {location: {href: "about:blank"}});
});

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

var _timers = [];
function setInterval(callback, delay) {
  var timer = Components.classes["@mozilla.org/timer;1"]
                        .createInstance(Components.interfaces.nsITimer);
  timer.init({observe: callback}, delay, Components.interfaces.nsITimer.TYPE_REPEATING_SLACK);
  _timers.push(timer);
}
function setTimeout(callback, delay) {
  var timer = Components.classes["@mozilla.org/timer;1"]
                        .createInstance(Components.interfaces.nsITimer);
  timer.init({
    observe: function(){
      delete _timers[this.index];
      callback();
    },
    index: _timers.length
  }, delay, Components.interfaces.nsITimer.TYPE_ONE_SHOT);
  _timers.push(timer);
}

function QueryInterface(iid) {
  if (iid.equals(Components.interfaces.nsISupports) ||
      iid.equals(Components.interfaces.nsIDOMWindow) ||
      iid.equals(Components.interfaces.nsIDOMWindowInternal))
    return this;

  if (iid.equals(Components.interfaces.nsIClassInfo))
    return this.wrapper;

  throw Components.results.NS_ERROR_NO_INTERFACE;
}

this.__defineGetter__("content", function() {
  return (_currentWindow && !_currentWindow.closed ? XPCNativeWrapper(_currentWindow) : null);
});
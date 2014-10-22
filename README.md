# Slip
A tiny library for interactive swiping and reordering of elements in lists on touch screens. No dependencies. BSD Licensed.

[Try **live demo**](http://pornel.net/slip/) (best on a touchscreen device)

Supports iOS Safari, Firefox Mobile, Chrome Mobile, Opera Mobile (Presto and Blink).

![Demo](http://pornel.net/slip/demo.gif)

## Usage

You interact with the library via custom DOM events for swipes/reordering.  Call `new Slip(<element>)` to make element's children swipeable and add event listeners for any of the following events:

* `slip:swipe`

    When swipe has been done and user has lifted finger off the screen.
    If you execute `event.preventDefault()` the element will be animated back to original position.
    Otherwise it will be animated off the list and set to `display:none`.

* `slip:beforeswipe`

    Fired before first swipe movement starts.
    If you execute `event.preventDefault()` then the element will not move at all.
    Parent element will have class `slip-swiping-container` for duration of the animation.

* `slip:reorder`

    Element has been dropped in new location. `event.detail` contains the location:

    * `insertBefore`: DOM node before which element has been dropped (`null` is the end of the list). Use with `node.insertBefore()`.
    * `spliceIndex`: Index of element before which current element has been dropped, not counting the element iself. For use with `Array.splice()` if the list is reflecting objects in some array.
    * `originalIndex`: The original index of the element.

* `slip:beforereorder`

    When reordering movement starts.
    Element being dragged gets `slip-reordering` class.
    If you execute `event.preventDefault()` then the element will not move at all.

* `slip:beforewait`

    If you execute `event.preventDefault()` then reordering will begin immediately, blocking ability to scroll the page. You can check `event.target` to limit that behavior to drag handles.

* `slip:tap`

    When element was tapped without being swiped/reordered.

* `slip:cancelswipe`

    Fired when the user stops dragging and the element returns to its original position.

### Example

```js
var list = document.querySelector('ul#slippylist');
new Slip(list);

list.addEventListener('slip:beforeswipe', function(e) {
    if (shouldNotSwipe(e.target)) {
        e.preventDefault(); // won't move sideways if prevented
    }
});

list.addEventListener('slip:swipe', function(e) {
    // e.target list item swiped
    if (thatWasSwipeToRemove) {
        // list will collapse over that element
        e.target.parentNode.removeChild(e.target);
    } else {
        e.preventDefault(); // will animate back to original position
    }
});

list.addEventListener('slip:beforereorder', function(e) {
    if (shouldNotReorder(e.target)) {
        // if prevented element won't move vertically
        e.preventDefault();
    }
});

list.addEventListener('slip:beforewait', function(e) {
    if (isScrollingKnob(e.target)) {
        // if prevented element will be dragged (instead of page scrolling)
        e.preventDefault();
    }
});

list.addEventListener('slip:reorder', function(e) {
    // e.target list item reordered.
    if (reorderedOK) {
        e.target.parentNode.insertBefore(e.target, e.detail.insertBefore);
    } else {
        // element will fly back to original position
        e.preventDefault();
    }
});
```

[See live example](http://pornel.net/slip/).

### CSS

The library doesn't *need* any special CSS, but there are some tweaks that can make it nicer.

If you don't need text selection you can disable it to make dragging easier:

```css
li {
    user-select: none;
}
```

You probably don't want horizontal scrollbar when elements are swiped off the list (`slip-swiping-container` class is set on container element only when necessary):

```css
.slip-swiping-container {
    overflow-x: hidden;
}
```

Class `slip-reordering` is set on list element that is being dragged:

```css
.slip-reordering {
    box-shadow: 0 2px 10px rgba(0,0,0,0.45);
}
```

## TODO

 * ARIA roles and screen reader testing.
 * Customizable delays and animations.
 * Using swipe to reveal UI beneath the element.

## Old browsers

 * Closure Compiler by default doesn't support ES5. Add `--language_in ECMASCRIPT5`.
 * For very old WebKit add `Function.bind` polyfill.
 * On mobile IE11 is [required](/pornel/slip/issues/2). On desktop IE9 should work.

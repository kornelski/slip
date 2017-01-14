# Slip
A tiny library for interactive swiping and reordering of elements in lists on touch screens. No dependencies. BSD Licensed.

[Try **live demo**](https://kornel.ski/slip/) (best on a touchscreen device)

Supports iOS Safari, Firefox Mobile, Chrome Mobile, Opera Mobile (Presto and Blink).

![Demo](https://kornel.ski/slip/demo.gif)

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

* `slip:cancelswipe`

    Fired after the user has started to swipe, but lets go without actually swiping left or right.

* `slip:animateswipe`

    Fired while swiping, before the user has let go of the element.
    `event.detail.x` contains the amount of movement in the x direction.
    If you execute `event.preventDefault()` then the element will not move to this position.
    This can be useful for saturating the amount of swipe, or preventing movement in one direction, but allowing it in the other.

* `slip:reorder`

    Element has been dropped in new location. `event.detail` contains the following:

    * `insertBefore`: DOM node before which element has been dropped (`null` is the end of the list). Use with `node.insertBefore()`.
    * `spliceIndex`: Index of element before which current element has been dropped, not counting the element iself. For use with `Array.splice()` if the list is reflecting objects in some array.
    * `originalIndex`: The original index of the element before it was reordered.

    You can use it to keep an array of items in sync with their display order:

    ```js
    const movedItem = itemsArray[event.detail.originalIndex];
    itemsArray.splice(event.detail.originalIndex, 1); // Remove item from the previous position
    itemsArray.splice(event.detail.spliceIndex, 0, movedItem); // Insert item in the new position

    // And update the DOM:
    e.target.parentNode.insertBefore(e.target, e.detail.insertBefore);
    ```

* `slip:beforereorder`

    When reordering movement starts.
    Element being reordered gets class `slip-reordering`.
    If you execute `event.preventDefault()` then the element will not move at all.

* `slip:beforewait`

    If you execute `event.preventDefault()` then reordering will begin immediately, blocking ability to scroll the page. You can check `event.target` to limit that behavior to drag handles.

* `slip:tap`

    When element was tapped without being swiped/reordered.


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

[See live example](https://kornel.ski/slip/).

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

When an item is dragged, `z-index` is set to 99999 on the element, so that it floats above the other elements in the list.  In order to make this effective in some browsers, you'll need to set `position: relative` on the list items.
```css
li {
    position: relative;
}
```

iOS also tends to add highlight color to tapped areas. If that bothers you, apply `-webkit-tap-highlight-color: rgba(0,0,0,0);` to tappable elements.

## Accessibility and focus management

In the source code there's an `accessibility` object with settings for enabling ARIA roles on elements and focus when elements are used. Set `focus: true` in that array for potentially improved screen reader use.

Please note that Slip does not support keyboard interaction (pull requests are welcome), so you need to provide your own keyboard-accessible alternative.

## TODO

 * ARIA roles and screen reader testing. Please note that drag'n'drop is very tricky to do with VoiceOver, and for accessibility you need a backup method.
 * Customizable delays and animations.
 * Using swipe to reveal UI beneath the element.

## Old browsers

 * Closure Compiler by default doesn't support ES5. Add `--language_in ECMASCRIPT5` or switch to UglifyJS2.
 * For very old WebKit add `Function.bind` polyfill.
 * PointerEvents are not supported, so only IE versions with TouchEvents (mobile 11+) are supported.

## Moving between two lists

For sake of simplicity of implementation and interaction dragging works only within a single list. If you need complex drag'n'drop, consider another, more generic library.

If you only need sorting between two lists (positioned one under another), then you can cheat a little by adding a non-draggable item to the list and styling it to look like a gap between the two lists.

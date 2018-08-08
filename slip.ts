/// <reference path="./slip.d.ts" />

import { IOptions, IPosition, ISibling, ISlip, IStateIdle, IStateUndecided, ITarget, ITransform } from './slip.d';

/*
    Slip - swiping and reordering in lists of elements on touch screens, no fuss.

    Fires these events on list elements:

        • slip:swipe
            When swipe has been done and user has lifted finger off the screen.
            If you execute event.preventDefault() the element will be animated back to original position.
            Otherwise it will be animated off the list and set to display:none.

        • slip:beforeswipe
            Fired before first swipe movement starts.
            If you execute event.preventDefault() then element will not move at all.

        • slip:cancelswipe
            Fired after the user has started to swipe, but lets go without actually swiping left or right.

        • slip:animateswipe
            Fired while swiping, before the user has let go of the element.
            event.detail.x contains the amount of movement in the x direction.
            If you execute event.preventDefault() then the element will not move to this position.
            This can be useful for saturating the amount of swipe, or preventing movement in one direction, but allowing it in the other.

        • slip:reorder
            Element has been dropped in new location. event.detail contains the following:
                • insertBefore: DOM node before which element has been dropped (null is the end of the list). Use with node.insertBefore().
                • spliceIndex: Index of element before which current element has been dropped, not counting the element iself.
                               For use with Array.splice() if the list is reflecting objects in some array.
                • originalIndex: The original index of the element before it was reordered.

        • slip:beforereorder
            When reordering movement starts.
            Element being reordered gets class `slip-reordering`.
            If you execute event.preventDefault() then the element will not move at all.

        • slip:beforewait
            If you execute event.preventDefault() then reordering will begin immediately, blocking ability to scroll the page.

        • slip:tap
            When element was tapped without being swiped/reordered. You can check `event.target` to limit that behavior to drag handles.


    Usage:

        CSS:
            You should set `user-select:none` (and WebKit prefixes, sigh) on list elements,
            otherwise unstoppable and glitchy text selection in iOS will get in the way.

            You should set `overflow-x: hidden` on the container or body to prevent horizontal scrollbar
            appearing when elements are swiped off the list.


        const list = document.querySelector('ul#slippylist');
        new Slip(list);

        list.addEventListener('slip:beforeswipe', e => {
            if (shouldNotSwipe(e.target)) e.preventDefault();
        });

        list.addEventListener('slip:swipe', e => {
            // e.target swiped
            if (thatWasSwipeToRemove) {
                e.target.parentNode.removeChild(e.target);
            } else {
                e.preventDefault(); // will animate back to original position
            }
        });

        list.addEventListener('slip:beforereorder', e => {
            if (shouldNotReorder(e.target)) e.preventDefault();
        });

        list.addEventListener('slip:reorder', e => {
            // e.target reordered.
            if (reorderedOK) {
                e.target.parentNode.insertBefore(e.target, e.detail.insertBefore);
            } else {
                e.preventDefault();
            }
        });

    Requires:
        • Touch events
        • CSS transforms
        • Function.bind()

    Caveats:
        • Elements must not change size while reordering or swiping takes place (otherwise it will be visually out of sync)
*/
/*! @license
    Slip.js 1.2.0

    © 2014 Kornel Lesiński <kornel@geekhood.net>. All rights reserved.

    Redistribution and use in source and binary forms, with or without modification,
    are permitted provided that the following conditions are met:

    1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

    2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and
       the following disclaimer in the documentation and/or other materials provided with the distribution.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES,
    INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
    DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
    SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
    SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
    WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE
    USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

export const Slip = function(this: ISlip): ISlip {
    const accessibility = {
        // Set values to false if you don't want Slip to manage them
        container: {
            ariaRole: 'listbox',
            tabIndex: 0,
            focus: false, // focuses after drop
        },
        items: {
            ariaRole: 'option', // If "option" flattens items, try "group": https://www.marcozehe.de/2013/03/08/sometimes-you-have-to-use-illegal-wai-aria-to-make-stuff-work/
            tabIndex: -1, // 0 will make every item tabbable, which isn't always useful
            focus: false, // focuses when dragging
        },
    };

    const damnYouChrome = /Chrome\/[3-5]/.test(navigator.userAgent); // For bugs that can't be programmatically detected :( Intended to catch all versions of Chrome 30-40
    const needsBodyHandlerHack = damnYouChrome; // Otherwise I _sometimes_ don't get any touchstart events and only clicks instead.

    /* When dragging elements down in Chrome (tested 34-37) dragged element may appear below stationary elements.
       Looks like WebKit bug #61824, but iOS Safari doesn't have that problem. */
    const compositorDoesNotOrderLayers = damnYouChrome;

    // -webkit-mess
    let testElementStyle: CSSStyleDeclaration | null = document.createElement('div').style;

    const transitionJSPropertyName = 'transition' in testElementStyle ? 'transition' : 'webkitTransition';
    const transformJSPropertyName = 'transform' in testElementStyle ? 'transform' : 'webkitTransform';
    const transformCSSPropertyName = transformJSPropertyName === 'webkitTransform' ? '-webkit-transform' : 'transform';
    const userSelectJSPropertyName = 'userSelect' in testElementStyle ? 'userSelect' : 'webkitUserSelect';

    testElementStyle[transformJSPropertyName] = 'translateZ(0)';
    const hwLayerMagicStyle = testElementStyle[transformJSPropertyName] ? 'translateZ(0) ' : '';
    const hwTopLayerMagicStyle = testElementStyle[transformJSPropertyName] ? 'translateZ(1px) ' : '';
    testElementStyle = null;

    let globalInstances = 0;
    let attachedBodyHandlerHack = false;
    const nullHandler = function() {};

    const Slip = function(this: ISlip, container: HTMLElement | null, options: IOptions) {
        if ('string' === typeof (container as any as string))
            container = document.querySelector<HTMLElement>(container as any as string);
        if (!container || !container.addEventListener) throw new Error('Please specify DOM node to attach to');

        if (!this || (this as any as Window) === window) return new Slip(container, options);

        this.options = options = options || {};
        this.options.keepSwipingPercent = options.keepSwipingPercent || 0;
        this.options.minimumSwipeVelocity = options.minimumSwipeVelocity || 1;
        this.options.minimumSwipeTime = options.minimumSwipeTime || 110;
        this.options.ignoredElements = options.ignoredElements || [];

        if (!Array.isArray(this.options.ignoredElements)) throw new Error('ignoredElements must be an Array');

        // Functions used for as event handlers need usable `this` and must not change to be removable
        this.cancel = this.setState.bind(this, this.states.idle);
        this.onTouchStart = this.onTouchStart.bind(this);
        this.onTouchMove = this.onTouchMove.bind(this);
        this.onTouchEnd = this.onTouchEnd.bind(this);
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        this.onMouseLeave = this.onMouseLeave.bind(this);
        this.onSelection = this.onSelection.bind(this);
        this.onContainerFocus = this.onContainerFocus.bind(this);

        this.setState(this.states.idle);
        this.attach(container);

        return this;
    } as any as {new(container: HTMLElement | null, options: IOptions): ISlip;};

    const getTransform = (node: HTMLElement): ITransform => {
        const transform = node.style[transformJSPropertyName];
        if (transform) {
            return {
                value: transform,
                original: transform,
            };
        }

        if (window.getComputedStyle) {
            const style = window.getComputedStyle(node).getPropertyValue(transformCSSPropertyName);
            if (style && style !== 'none') return { value: style, original: '' };
        }
        return { value: '', original: '' };
    };

    const findIndex = (target: {node: HTMLElement}, nodes: NodeListOf<Node & ChildNode>): number => {
        let originalIndex = 0;
        let listCount = 0;

        for (let i = 0; i < nodes.length; i++) {
            if (nodes[i].nodeType === 1) {
                listCount++;
                if (nodes[i] === target.node) {
                    originalIndex = listCount - 1;
                }
            }
        }

        return originalIndex;
    };

    // All functions in states are going to be executed in context of Slip object
    Slip.prototype = {

        container: null,
        options: {},
        state: null,

        target: null, // the tapped/swiped/reordered node with height and backed up styles

        usingTouch: false, // there's no good way to detect touchscreen preference other than receiving a touch event (really, trust me).
        mouseHandlersAttached: false,

        startPosition: null, // x,y,time where first touch began
        latestPosition: null, // x,y,time where the finger is currently
        previousPosition: null, // x,y,time where the finger was ~100ms ago (for velocity calculation)

        canPreventScrolling: false,

        states: {
            idle: function idleStateInit(this: IStateIdle) {
                this.removeMouseHandlers();
                if (this.target) {
                    this.target.node.style.willChange = '';
                    this.target = null;
                }
                this.usingTouch = false;

                return {
                    allowTextSelection: true,
                };
            },

            undecided: function undecidedStateInit(this: IStateUndecided) {
                this.target.height = this.target.node.offsetHeight;
                this.target.node.style.willChange = transformCSSPropertyName;
                this.target.node.style[transitionJSPropertyName] = '';

                if (!this.dispatch(this.target.originalTarget, 'beforewait')) {
                    if (this.dispatch(this.target.originalTarget, 'beforereorder')) {
                        this.setState(this.states.reorder);
                    }
                } else {
                    const holdTimer = setTimeout(() => {
                        const move = this.getAbsoluteMovement();
                        if (this.canPreventScrolling && move.x < 15 && move.y < 25) {
                            if (this.dispatch(this.target.originalTarget, 'beforereorder')) {
                                this.setState(this.states.reorder);
                            }
                        }
                    }, 300);
                }

                return {
                    leaveState: () => clearTimeout(holdTimer),
                    onMove: () => {
                        const move = this.getAbsoluteMovement();

                        if (move.x > 20 && move.y < Math.max(100, this.target.height || 0)) {
                            if (this.dispatch(this.target.originalTarget, 'beforeswipe', {
                                directionX: move.directionX,
                                directionY: move.directionY
                            })) {
                                this.setState(this.states.swipe);
                                return false;
                            } else {
                                this.setState(this.states.idle);
                            }
                        }
                        if (move.y > 20) {
                            this.setState(this.states.idle);
                        }

                        // Chrome likes sideways scrolling :(
                        if (move.x > move.y * 1.2) return false;
                    },

                    onLeave: () => this.setState(this.states.idle),
                    onEnd: () => {
                        const allowDefault = this.dispatch(this.target.originalTarget, 'tap');
                        this.setState(this.states.idle);
                        return allowDefault;
                    },
                };
            },

            swipe: () => {
                let swipeSuccess = false;
                const container = this.container;

                const originalIndex = findIndex(this.target, this.container.childNodes);

                container.classList.add('slip-swiping-container');

                const removeClass = () => container.classList.remove('slip-swiping-container');

                this.target.height = this.target.node.offsetHeight;

                return {
                    leaveState: () => {
                        if (swipeSuccess) {
                            this.animateSwipe(target => {
                                target.node.style[transformJSPropertyName] = target.baseTransform.original;
                                target.node.style[transitionJSPropertyName] = '';
                                if (this.dispatch(target.node, 'afterswipe')) {
                                    removeClass();
                                    return true;
                                } else {
                                    this.animateToZero(undefined, target);
                                }
                            });
                        } else {
                            this.animateToZero(removeClass);
                        }
                    },

                    onMove: () => {
                        const move = this.getTotalMovement();

                        if (this.target.height && Math.abs(move.y) < this.target.height + 20) {
                            if (this.dispatch(this.target.node, 'animateswipe', {
                                x: move.x,
                                originalIndex: originalIndex
                            })) {
                                this.target.node.style[transformJSPropertyName] = 'translate(' + move.x + 'px,0) ' + hwLayerMagicStyle + this.target.baseTransform.value;
                            }
                            return false;
                        } else {
                            this.dispatch(this.target.node, 'cancelswipe');
                            this.setState(this.states.idle);
                        }
                    },

                    onLeave: this.state.onEnd,

                    onEnd: () => {
                        const move = this.getAbsoluteMovement();
                        const velocity = move.x / move.time;

                        // How far out has the item been swiped?
                        const swipedPercent = Math.abs((this.startPosition.x - this.previousPosition.x) / this.container.clientWidth) * 100;

                        const swiped = (velocity > this.options.minimumSwipeVelocity && move.time > this.options.minimumSwipeTime) || (this.options.keepSwipingPercent && swipedPercent > this.options.keepSwipingPercent);

                        if (swiped) {
                            if (this.dispatch(this.target.node, 'swipe', {
                                direction: move.directionX,
                                originalIndex: originalIndex
                            })) {
                                swipeSuccess = true; // can't animate here, leaveState overrides anim
                            }
                        } else {
                            this.dispatch(this.target.node, 'cancelswipe');
                        }
                        this.setState(this.states.idle);
                        return !swiped;
                    },
                };
            },

            reorder: () => {
                if (this.target.node.focus && accessibility.items.focus) {
                    this.target.node.focus();
                }

                this.target.height = this.target.node.offsetHeight;

                let nodes: NodeListOf<Node & ChildNode>;
                if (this.options.ignoredElements.length) {
                    const container = this.container;
                    let query = container.tagName.toLowerCase();
                    if (container.getAttribute('id')) {
                        query = '#' + container.getAttribute('id');
                    } else if (container.classList.length) {
                        query += '.' + (container.getAttribute('class') as string)
                            .replace(' ', '.');
                    }
                    query += ' > ';
                    this.options.ignoredElements.forEach((selector) => {
                        query += ':not(' + selector + ')';
                    });
                    try {
                        nodes = (container.parentNode as Element).querySelectorAll(query);
                    } catch (err) {
                        if (err instanceof DOMException && err.name === 'SyntaxError')
                            throw new Error('ignoredElements you specified contain invalid query');
                        else
                            throw err;
                    }
                } else {
                    nodes = this.container.childNodes as NodeListOf<Node & ChildNode>;
                }
                const originalIndex = findIndex(this.target, nodes);
                let mouseOutsideTimer: number | null;
                const zero = this.target.node.offsetTop + this.target.height / 2;
                const otherNodes: {node: Node & ChildNode, baseTransform: ITransform, pos: number}[] = [];
                for (let i = 0; i < nodes.length; i++) {
                    if (nodes[i].nodeType != 1 || nodes[i] === this.target.node) continue;
                    const t = (nodes[i] as HTMLElement).offsetTop;
                    (nodes[i] as HTMLElement).style[transitionJSPropertyName] = transformCSSPropertyName + ' 0.2s ease-in-out';
                    otherNodes.push({
                        node: nodes[i],
                        baseTransform: getTransform(nodes[i] as HTMLElement),
                        pos: t + (t < zero ? (nodes[i] as HTMLElement).offsetHeight : 0) - zero,
                    });
                }

                this.target.node.classList.add('slip-reordering');
                this.target.node.style.zIndex = '99999';
                this.target.node.style[userSelectJSPropertyName] = 'none';
                if (compositorDoesNotOrderLayers) {
                    // Chrome's compositor doesn't sort 2D layers
                    this.container.style.webkitTransformStyle = 'preserve-3d';
                }

                const onMove = () => {
                    /*jshint validthis:true */

                    this.updateScrolling();

                    if (mouseOutsideTimer) {
                        // don't care where the mouse is as long as it moves
                        clearTimeout(mouseOutsideTimer);
                        mouseOutsideTimer = null;
                    }

                    const move = this.getTotalMovement();
                    this.target.node.style[transformJSPropertyName] = 'translate(0,' + move.y + 'px) ' + hwTopLayerMagicStyle + this.target.baseTransform.value;

                    const height = this.target.height || 0;
                    otherNodes.forEach(function(o) {
                        let off = 0;
                        if (o.pos < 0 && move.y < 0 && o.pos > move.y) {
                            off = height;
                        }
                        else if (o.pos > 0 && move.y > 0 && o.pos < move.y) {
                            off = -height;
                        }
                        // FIXME: should change accelerated/non-accelerated state lazily
                        (o.node as HTMLElement).style[transformJSPropertyName] = off ? 'translate(0,' + off + 'px) ' + hwLayerMagicStyle + o.baseTransform.value : o.baseTransform.original;
                    });
                    return false;
                };

                onMove();

                return {
                    leaveState: () => {
                        if (mouseOutsideTimer) clearTimeout(mouseOutsideTimer);

                        if (compositorDoesNotOrderLayers) {
                            this.container.style.webkitTransformStyle = '';
                        }

                        if (this.container.focus && accessibility.container.focus) {
                            this.container.focus();
                        }

                        this.target.node.classList.remove('slip-reordering');
                        this.target.node.style[userSelectJSPropertyName] = '';

                        this.animateToZero((target: ITarget) => target.node.style.zIndex = '');
                        otherNodes.forEach(o => {
                            (o.node as HTMLElement).style[transformJSPropertyName] = o.baseTransform.original;
                            (o.node as HTMLElement).style[transitionJSPropertyName] = ''; // FIXME: animate to new position
                        });
                    },

                    onMove: onMove,

                    onLeave: () => {
                        // don't let element get stuck if mouse left the window
                        // but don't cancel immediately as it'd be annoying near window edges
                        if (mouseOutsideTimer) clearTimeout(mouseOutsideTimer);
                        mouseOutsideTimer = setTimeout(() => {
                                mouseOutsideTimer = null;
                                this.cancel();
                            }, 700
                        )
                        ;
                    },

                    onEnd: () => {
                        const move = this.getTotalMovement();
                        let i, spliceIndex;
                        if (move.y < 0) {
                            for (i = 0; i < otherNodes.length; i++) {
                                if (otherNodes[i].pos > move.y) {
                                    break;
                                }
                            }
                            spliceIndex = i;
                        } else {
                            for (i = otherNodes.length - 1; i >= 0; i--) {
                                if (otherNodes[i].pos < move.y) {
                                    break;
                                }
                            }
                            spliceIndex = i + 1;
                        }

                        this.dispatch(this.target.node, 'reorder', {
                            spliceIndex: spliceIndex,
                            originalIndex: originalIndex,
                            insertBefore: otherNodes[spliceIndex] ? (otherNodes[spliceIndex] as any).node : undefined,
                        });

                        this.setState(this.states.idle);
                        return false;
                    },
                };
            },
        },

        attach: (container: HTMLElement) => {
            globalInstances++;
            if (this.container) this.detach();

            // In some cases taps on list elements send *only* click events and no touch events. Spotted only in Chrome 32+
            // Having event listener on body seems to solve the issue (although AFAIK may disable smooth scrolling as a side-effect)
            if (!attachedBodyHandlerHack && needsBodyHandlerHack) {
                attachedBodyHandlerHack = true;
                document.body.addEventListener('touchstart', nullHandler, false);
            }

            this.container = container;

            // Accessibility
            if (false !== accessibility.container.tabIndex as any as boolean) {
                this.container.tabIndex = accessibility.container.tabIndex;
            }
            if (accessibility.container.ariaRole) {
                this.container.setAttribute('aria-role', accessibility.container.ariaRole);
            }
            this.setChildNodesAriaRoles();
            this.container.addEventListener('focus', this.onContainerFocus, false);

            this.otherNodes = [];

            // selection on iOS interferes with reordering
            document.addEventListener('selectionchange', this.onSelection, false);

            // cancel is called e.g. when iOS detects multitasking gesture
            this.container.addEventListener('touchcancel', this.cancel, false);
            this.container.addEventListener('touchstart', this.onTouchStart, false);
            this.container.addEventListener('touchmove', this.onTouchMove, false);
            this.container.addEventListener('touchend', this.onTouchEnd, false);
            this.container.addEventListener('mousedown', this.onMouseDown, false);
            // mousemove and mouseup are attached dynamically
        },

        detach: () => {
            this.cancel();

            this.container.removeEventListener('mousedown', this.onMouseDown, false);
            this.container.removeEventListener('touchend', this.onTouchEnd, false);
            this.container.removeEventListener('touchmove', this.onTouchMove, false);
            this.container.removeEventListener('touchstart', this.onTouchStart, false);
            this.container.removeEventListener('touchcancel', this.cancel, false);

            document.removeEventListener('selectionchange', this.onSelection, false);

            if (false !== accessibility.container.tabIndex as any as boolean) {
                this.container.removeAttribute('tabIndex');
            }
            if (accessibility.container.ariaRole) {
                this.container.removeAttribute('aria-role');
            }
            this.unSetChildNodesAriaRoles();

            globalInstances--;
            if (!globalInstances && attachedBodyHandlerHack) {
                attachedBodyHandlerHack = false;
                document.body.removeEventListener('touchstart', nullHandler, false);
            }
        },

        setState: (newStateCtor: {new(): any}) => {
            if (this.state) {
                if (this.state.ctor === newStateCtor) return;
                if (this.state.leaveState) this.state.leaveState.call(this);
            }

            // Must be re-entrant in case ctor changes state
            const prevState = this.state;
            const nextState = newStateCtor.call(this);
            if (this.state === prevState) {
                nextState.ctor = newStateCtor;
                this.state = nextState;
            }
        },

        findTargetNode: (targetNode: Node | null): Node | null => {
            while (targetNode && targetNode.parentNode !== this.container) {
                if (targetNode.parentNode != null)
                    targetNode = targetNode.parentNode;
            }
            return targetNode;
        },

        onContainerFocus: (e: TouchEvent) => {
            e.stopPropagation();
            this.setChildNodesAriaRoles();
        },

        setChildNodesAriaRoles: () => {
            const nodes = this.container.childNodes as NodeListOf<HTMLElement>;
            for (let i = 0; i < nodes.length; i++) {
                if (nodes[i].nodeType != 1) continue;
                if (accessibility.items.ariaRole) {
                    nodes[i].setAttribute('aria-role', accessibility.items.ariaRole);
                }
                if (false !== accessibility.items.tabIndex as any as boolean) {
                    nodes[i].tabIndex = accessibility.items.tabIndex;
                }
            }
        },

        unSetChildNodesAriaRoles: () => {
            const nodes = this.container.childNodes as NodeListOf<HTMLElement>;
            for (let i = 0; i < nodes.length; i++) {
                if (nodes[i].nodeType != 1) continue;
                if (accessibility.items.ariaRole) {
                    nodes[i].removeAttribute('aria-role');
                }
                if (false !== accessibility.items.tabIndex as any as boolean) {
                    nodes[i].removeAttribute('tabIndex');
                }
            }
        },
        onSelection: (e: Event & Node) => {
            e.stopPropagation();
            const isRelated = e.target === document || this.findTargetNode(e);
            const iOS = /(iPhone|iPad|iPod)/i.test(navigator.userAgent) && !/(Android|Windows)/i.test(navigator.userAgent);
            if (!isRelated) return;

            if (iOS) {
                // iOS doesn't allow selection to be prevented
                this.setState(this.states.idle);
            } else {
                if (!this.state.allowTextSelection) {
                    e.preventDefault();
                }
            }
        },

        addMouseHandlers: () => {
            // unlike touch events, mousemove/up is not conveniently fired on the same element,
            // but I don't need to listen to unrelated events all the time
            if (!this.mouseHandlersAttached) {
                this.mouseHandlersAttached = true;
                document.documentElement.addEventListener('mouseleave', this.onMouseLeave, false);
                window.addEventListener('mousemove', this.onMouseMove, true);
                window.addEventListener('mouseup', this.onMouseUp, true);
                window.addEventListener('blur', this.cancel, false);
            }
        },

        removeMouseHandlers: () => {
            if (this.mouseHandlersAttached) {
                this.mouseHandlersAttached = false;
                document.documentElement.removeEventListener('mouseleave', this.onMouseLeave, false);
                window.removeEventListener('mousemove', this.onMouseMove, true);
                window.removeEventListener('mouseup', this.onMouseUp, true);
                window.removeEventListener('blur', this.cancel, false);
            }
        },

        onMouseLeave: (e: MouseEvent) => {
            e.stopPropagation();
            if (this.usingTouch) return;

            if (e.target === document.documentElement || e.relatedTarget === document.documentElement) {
                if (this.state.onLeave) {
                    this.state.onLeave.call(this);
                }
            }
        },

        onMouseDown: (e: MouseEvent & MSGesture) => {
            e.stopPropagation();
            if (this.usingTouch || e.button != 0 || !this.setTarget(e)) return;

            this.addMouseHandlers(); // mouseup, etc.

            this.canPreventScrolling = true; // or rather it doesn't apply to mouse

            this.startAtPosition({
                x: e.clientX,
                y: e.clientY,
                time: e.timeStamp,
            });
        },

        onTouchStart: (e: TouchEvent) => {
            e.stopPropagation();
            this.usingTouch = true;
            this.canPreventScrolling = true;

            // This implementation cares only about single touch
            if (e.touches.length > 1) {
                this.setState(this.states.idle);
                return;
            }

            if (e.target != null && !this.setTarget(e)) return;

            this.startAtPosition({
                x: e.touches[0].clientX,
                y: e.touches[0].clientY,
                time: e.timeStamp,
            });
        },

        setTarget: (e: Event & {target?: Node | null}): boolean => {
            const targetNode = this.findTargetNode(e.target);
            if (!targetNode) {
                this.setState(this.states.idle);
                return false;
            }

            //check for a scrollable parent
            let scrollContainer = targetNode.parentNode as HTMLElement;
            while (scrollContainer) {
                if (scrollContainer == document.body) break;
                if (scrollContainer.scrollHeight > scrollContainer.clientHeight && window.getComputedStyle(scrollContainer).overflowY !== 'visible') break;
                scrollContainer = scrollContainer.parentNode as HTMLElement;
            }
            scrollContainer = scrollContainer || document.body;

            this.target = {
                originalTarget: e.target as any as ITarget,
                node: targetNode as ITarget['node'],
                scrollContainer: scrollContainer,
                origScrollTop: scrollContainer.scrollTop,
                origScrollHeight: scrollContainer.scrollHeight,
                baseTransform: getTransform(targetNode as HTMLElement),
            };
            return true;
        },

        startAtPosition: (pos: IPosition) => {
            this.startPosition = this.previousPosition = this.latestPosition = pos;
            this.setState(this.states.undecided);
        },

        updatePosition: (e: MouseEvent | TouchEvent, pos: IPosition) => {
            if (this.target == null) {
                return;
            }
            this.latestPosition = pos;

            if (this.state.onMove) {
                if (this.state.onMove.call(this) === false) {
                    e.preventDefault();
                }
            }

            // sample latestPosition 100ms for velocity
            if (this.latestPosition.time - this.previousPosition.time > 100) {
                this.previousPosition = this.latestPosition;
            }
        },

        onMouseMove: (e: MouseEvent) => {
            e.stopPropagation();
            this.updatePosition(e, {
                x: e.clientX,
                y: e.clientY,
                time: e.timeStamp,
            });
        },

        onTouchMove: (e: TouchEvent) => {
            e.stopPropagation();
            this.updatePosition(e, {
                x: e.touches[0].clientX,
                y: e.touches[0].clientY,
                time: e.timeStamp,
            });

            // In Apple's touch model only the first move event after touchstart can prevent scrolling (and event.cancelable is broken)
            this.canPreventScrolling = false;
        },

        onMouseUp: (e: MouseEvent) => {
            e.stopPropagation();
            if (this.usingTouch || e.button !== 0) return;

            if (this.state.onEnd && false === this.state.onEnd.call(this)) {
                e.preventDefault();
            }
        },

        onTouchEnd: (e: TouchEvent) => {
            e.stopPropagation();
            if (e.touches.length > 1) {
                this.cancel();
            } else if (this.state.onEnd && false === this.state.onEnd.call(this)) {
                e.preventDefault();
            }
        },

        getTotalMovement: (): ISlip['latestPosition'] => {
            const scrollOffset = this.target.scrollContainer.scrollTop - this.target.origScrollTop;
            return {
                x: this.latestPosition.x - this.startPosition.x,
                y: this.latestPosition.y - this.startPosition.y + scrollOffset,
                time: this.latestPosition.time - this.startPosition.time,
            };
        },

        getAbsoluteMovement: () => {
            const move = this.getTotalMovement();
            return {
                x: Math.abs(move.x),
                y: Math.abs(move.y),
                time: move.time,
                directionX: move.x < 0 ? 'left' : 'right',
                directionY: move.y < 0 ? 'up' : 'down',
            };
        },

        updateScrolling: () => {
            const triggerOffset = 40;
            let offset = 0;

            const scrollable = this.target.scrollContainer,
                containerRect = scrollable.getBoundingClientRect(),
                targetRect = this.target.node.getBoundingClientRect(),
                bottomOffset = Math.min(containerRect.bottom, window.innerHeight) - targetRect.bottom,
                topOffset = targetRect.top - Math.max(containerRect.top, 0),
                maxScrollTop = this.target.origScrollHeight - Math.min(scrollable.clientHeight, window.innerHeight);

            if (bottomOffset < triggerOffset) {
                offset = Math.min(triggerOffset, triggerOffset - bottomOffset);
            }
            else if (topOffset < triggerOffset) {
                offset = Math.max(-triggerOffset, topOffset - triggerOffset);
            }

            scrollable.scrollTop = Math.max(0, Math.min(maxScrollTop, scrollable.scrollTop + offset));
        },

        dispatch: (targetNode: EventTarget, eventName: string, detail: any) => {
            let event = document.createEvent('CustomEvent');
            if (event && event.initCustomEvent) {
                event.initCustomEvent('slip:' + eventName, true, true, detail);
            } else {
                event = document.createEvent('Event') as CustomEvent<any>;
                event.initEvent('slip:' + eventName, true, true);
                event.detail = detail;
            }
            return targetNode.dispatchEvent(event);
        },

        getSiblings: (target: ITarget): ISibling[] => {
            const siblings = [];
            let tmp = target.node.nextSibling;
            while (tmp) {
                if (tmp.nodeType == 1) siblings.push({
                    node: tmp as HTMLElement,
                    baseTransform: getTransform(tmp as HTMLElement),
                });
                tmp = tmp.nextSibling;
            }
            return siblings;
        },

        animateToZero: (callback: (target: ITarget) => void, target: ITarget) => {
            // save, because this.target/container could change during animation
            target = target || this.target;

            target.node.style[transitionJSPropertyName] = transformCSSPropertyName + ' 0.1s ease-out';
            target.node.style[transformJSPropertyName] = 'translate(0,0) ' + hwLayerMagicStyle + target.baseTransform.value;
            setTimeout(() => {
                    target.node.style[transitionJSPropertyName] = '';
                    target.node.style[transformJSPropertyName] = target.baseTransform.original;
                    if (callback) callback.call(this, target);
                }, 101
            );
        },

        animateSwipe: (callback: (target: ITarget) => void): void | boolean => {
            const target: ITarget = this.target;
            const siblings = this.getSiblings(target);
            const emptySpaceTransformStyle = 'translate(0,' + this.target.height + 'px) ' + hwLayerMagicStyle + ' ';

            // FIXME: animate with real velocity
            target.node.style[transitionJSPropertyName] = 'all 0.1s linear';
            target.node.style[transformJSPropertyName] = ' translate(' + (this.getTotalMovement().x > 0 ? '' : '-') + '100%,0) ' + hwLayerMagicStyle + target.baseTransform.value;

            setTimeout(() => {
                    if (callback.call(this, target)) {
                        siblings.forEach((o: ISibling) => {
                            o.node.style[transitionJSPropertyName] = '';
                            o.node.style[transformJSPropertyName] = emptySpaceTransformStyle + o.baseTransform.value;
                        });
                        setTimeout(() => {
                            siblings.forEach((o: ISibling) => {
                                o.node.style[transitionJSPropertyName] = transformCSSPropertyName + ' 0.1s ease-in-out';
                                o.node.style[transformJSPropertyName] = 'translate(0,0) ' + hwLayerMagicStyle + o.baseTransform.value;
                            });
                            setTimeout(() => {
                                siblings.forEach((o: ISibling) => {
                                    o.node.style[transitionJSPropertyName] = '';
                                    o.node.style[transformJSPropertyName] = o.baseTransform.original;
                                });
                            }, 101);
                        }, 1);
                    }
                }, 101
            );
        },
    };
    return Slip;
};

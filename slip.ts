/// <reference path="./slip.d.ts" />

import {
    IMove,
    IOptions,
    IPosition,
    ISibling,
    ISlip,
    IState,
    IStateImplement,
    IStates,
    ITarget,
    ITransform,
    TEvent
} from './slip.d';

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

export class Slip implements ISlip {
    private static nullHandler = function() {};
    private state?: IState = undefined;
    cancel!: ISlip['cancel'];
    private usingTouch: boolean = false; // there's no good way to detect touchscreen preference other than receiving a touch event (really, trust me).
    private mouseHandlersAttached: boolean = false;
    states!: ISlip['states'];
    private target!: ITarget; // the tapped/swiped/reordered node with height and backed up styles
    private previousPosition?: IPosition = undefined; // x,y,time where the finger was ~100ms ago (for velocity calculation)
    private accessibility = {
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
    private damnYouChrome = /Chrome\/[3-5]/.test(navigator.userAgent); // For bugs that can't be programmatically detected :( Intended to catch all versions of Chrome 30-40
    private needsBodyHandlerHack = this.damnYouChrome; // Otherwise I _sometimes_ don't get any touchstart events and only clicks instead.
    /* When dragging elements down in Chrome (tested 34-37) dragged element may appear below stationary elements.
       Looks like WebKit bug #61824, but iOS Safari doesn't have that problem. */
    private compositorDoesNotOrderLayers = this.damnYouChrome;
    private canPreventScrolling: boolean = false;
    private startPosition!: IPosition; // x,y,time where first touch began
    private transitionJSPropertyName = 'transition'.indexOf(this.testElementStyle.toString()) > -1 ? 'transition' : 'webkitTransition';
    private transformJSPropertyName: string = 'transform'.indexOf(this.testElementStyle.toString()) > -1 ? 'transform' : 'webkitTransform';
    private userSelectJSPropertyName = 'userSelect'.indexOf(this.testElementStyle.toString()) > -1 ? 'userSelect' : 'webkitUserSelect';
    private latestPosition!: IPosition; // x,y,time where the finger is currently
    // -webkit-mess
    private testElementStyle: {[index: string]: string} = document.createElement('div').style as any;
    private globalInstances = 0;
    private attachedBodyHandlerHack = false;
    private transformCSSPropertyName!: string;
    private hwLayerMagicStyle = this.testElementStyle[this.transformJSPropertyName as any] ? 'translateZ(0) ' : '';
    private hwTopLayerMagicStyle = this.testElementStyle[this.transformJSPropertyName as any] ? 'translateZ(1px) ' : '';

    constructor(private container: HTMLElement, private options: IOptions) {
        this.transformCSSPropertyName = this.transformJSPropertyName === 'webkitTransform' ? '-webkit-transform' : 'transform';
        this.testElementStyle[this.transformJSPropertyName as string] = 'translateZ(0)';
        if ('string' === typeof (container as any as string))
            this.container = document.querySelector<HTMLElement>(container as any as string) as HTMLElement;
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

        this.states = this._states();

        return this;
    }

    detach() {
        this.cancel();

        this.container.removeEventListener('mousedown', this.onMouseDown, false);
        this.container.removeEventListener('touchend', this.onTouchEnd, false);
        this.container.removeEventListener('touchmove', this.onTouchMove, false);
        this.container.removeEventListener('touchstart', this.onTouchStart, false);
        this.container.removeEventListener('touchcancel', this.cancel, false);

        document.removeEventListener('selectionchange', this.onSelection, false);

        if (false !== this.accessibility.container.tabIndex as any as boolean) {
            this.container.removeAttribute('tabIndex');
        }
        if (this.accessibility.container.ariaRole) {
            this.container.removeAttribute('aria-role');
        }
        this.unSetChildNodesAriaRoles();

        this.globalInstances--;
        if (!this.globalInstances && this.attachedBodyHandlerHack) {
            this.attachedBodyHandlerHack = false;
            document.body.removeEventListener('touchstart', Slip.nullHandler, false);
        }
    }

    attach(container: HTMLElement) {
        this.globalInstances++;
        if (this.container) this.detach();

        // In some cases taps on list elements send *only* click events and no touch events. Spotted only in Chrome 32+
        // Having event listener on body seems to solve the issue (although AFAIK may disable smooth scrolling as a side-effect)
        if (!this.attachedBodyHandlerHack && this.needsBodyHandlerHack) {
            this.attachedBodyHandlerHack = true;
            document.body.addEventListener('touchstart', Slip.nullHandler, false);
        }

        this.container = container;

        // Accessibility
        if (false !== this.accessibility.container.tabIndex as any as boolean) {
            this.container.tabIndex = this.accessibility.container.tabIndex;
        }
        if (this.accessibility.container.ariaRole) {
            this.container.setAttribute('aria-role', this.accessibility.container.ariaRole);
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
    }

    setState(newStateCtor: () => void) {
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
    }

    setChildNodesAriaRoles() {
        const nodes = this.container.childNodes as NodeListOf<HTMLElement>;
        for (let i = 0; i < nodes.length; i++) {
            if (nodes[i].nodeType != 1) continue;
            if (this.accessibility.items.ariaRole) {
                nodes[i].setAttribute('aria-role', this.accessibility.items.ariaRole);
            }
            if (false !== this.accessibility.items.tabIndex as any as boolean) {
                nodes[i].tabIndex = this.accessibility.items.tabIndex;
            }
        }
    }

    unSetChildNodesAriaRoles() {
        const nodes = this.container.childNodes as NodeListOf<HTMLElement>;
        for (let i = 0; i < nodes.length; i++) {
            if (nodes[i].nodeType != 1) continue;
            if (this.accessibility.items.ariaRole) {
                nodes[i].removeAttribute('aria-role');
            }
            if (false !== this.accessibility.items.tabIndex as any as boolean) {
                nodes[i].removeAttribute('tabIndex');
            }
        }
    }

    setTarget(e: MouseEvent & MSGesture): boolean {
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
            baseTransform: this.getTransform(targetNode as HTMLElement),
        };
        return true;
    }

    findTargetNode(targetNode: Node | null): Node | null {
        while (targetNode && targetNode.parentNode !== this.container) {
            if (targetNode.parentNode != null)
                targetNode = targetNode.parentNode;
        }
        return targetNode;
    }

    onContainerFocus(e: TouchEvent) {
        e.stopPropagation();
        this.setChildNodesAriaRoles();
    }

    getAbsoluteMovement(): Required<IMove> {
        const move = this.getTotalMovement() as Required<IMove>;
        return {
            x: Math.abs(move.x),
            y: Math.abs(move.y),
            time: move.time,
            directionX: move.x < 0 ? 'left' : 'right',
            directionY: move.y < 0 ? 'up' : 'down',
        } as any;
    }

    getTotalMovement(): IPosition {
        const scrollOffset = this.target.scrollContainer.scrollTop - this.target.origScrollTop;
        return {
            x: this.latestPosition.x - this.startPosition.x,
            y: this.latestPosition.y - this.startPosition.y + scrollOffset,
            time: this.latestPosition.time - this.startPosition.time,
        };
    }

    onSelection(e: Event & Node) {
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
    }

    addMouseHandlers() {
        // unlike touch events, mousemove/up is not conveniently fired on the same element,
        // but I don't need to listen to unrelated events all the time
        if (!this.mouseHandlersAttached) {
            this.mouseHandlersAttached = true;
            document.documentElement.addEventListener('mouseleave', this.onMouseLeave, false);
            window.addEventListener('mousemove', this.onMouseMove, true);
            window.addEventListener('mouseup', this.onMouseUp, true);
            window.addEventListener('blur', this.cancel, false);
        }
    }

    removeMouseHandlers() {
        if (this.mouseHandlersAttached) {
            this.mouseHandlersAttached = false;
            document.documentElement.removeEventListener('mouseleave', this.onMouseLeave, false);
            window.removeEventListener('mousemove', this.onMouseMove, true);
            window.removeEventListener('mouseup', this.onMouseUp, true);
            window.removeEventListener('blur', this.cancel, false);
        }
    }

    onMouseLeave(e: MouseEvent) {
        e.stopPropagation();
        if (this.usingTouch) return;

        if (e.target === document.documentElement || e.relatedTarget === document.documentElement) {
            if (this.state.onLeave) {
                this.state.onLeave.call(this);
            }
        }
    }

    onMouseDown(e: MouseEvent & MSGesture) {
        e.stopPropagation();
        if (this.usingTouch || e.button != 0 || !this.setTarget(e)) return;

        this.addMouseHandlers(); // mouseup, etc.

        this.canPreventScrolling = true; // or rather it doesn't apply to mouse

        this.startAtPosition({
            x: e.clientX,
            y: e.clientY,
            time: e.timeStamp,
        });
    }

    onTouchStart(e: TouchEvent) {
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
    }

    dispatch(targetNode: EventTarget, eventName: TEvent, detail?: IMove) {
        let event = document.createEvent('CustomEvent');
        if (event && event.initCustomEvent) {
            event.initCustomEvent('slip:' + eventName, true, true, detail);
        } else {
            event = document.createEvent('Event') as CustomEvent<any>;
            event.initEvent('slip:' + eventName, true, true);
            // event.detail = detail;
        }
        return targetNode.dispatchEvent(event);
    }

    startAtPosition(pos: IPosition) {
        this.startPosition = this.previousPosition = this.latestPosition = pos;
        this.setState(this.states.undecided);
    }

    updatePosition(e: MouseEvent | TouchEvent, pos: IPosition) {
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
    }

    onMouseMove(e: MouseEvent) {
        e.stopPropagation();
        this.updatePosition(e, {
            x: e.clientX,
            y: e.clientY,
            time: e.timeStamp,
        });
    }

    onTouchMove(e: TouchEvent) {
        e.stopPropagation();
        this.updatePosition(e, {
            x: e.touches[0].clientX,
            y: e.touches[0].clientY,
            time: e.timeStamp,
        });

        // In Apple's touch model only the first move event after touchstart can prevent scrolling (and event.cancelable is broken)
        this.canPreventScrolling = false;
    }

    onMouseUp(e: MouseEvent) {
        e.stopPropagation();
        if (this.usingTouch || e.button !== 0) return;

        if (this.state.onEnd && false === this.state.onEnd.call(this)) {
            e.preventDefault();
        }
    }

    onTouchEnd(e: TouchEvent) {
        e.stopPropagation();
        if (e.touches.length > 1) {
            this.cancel();
        } else if (this.state.onEnd && false === this.state.onEnd.call(this)) {
            e.preventDefault();
        }
    }

    animateToZero(callback?: (target: ITarget) => void, target?: ITarget) {
        // save, because this.target/container could change during animation
        target = target || this.target;

        target.node.style[this.transitionJSPropertyName as any] = this.transformCSSPropertyName + ' 0.1s ease-out';
        target.node.style[this.transformJSPropertyName as any] = 'translate(0,0) ' + this.hwLayerMagicStyle + target.baseTransform.value;
        setTimeout(() => {
                if (target != null) {
                    target.node.style[this.transitionJSPropertyName as any] = '';
                    target.node.style[this.transformJSPropertyName as any] = target.baseTransform.original;
                }
                if (callback) callback.call(this, target);
            }, 101
        );
    }

    getSiblings(target: ITarget): ISibling[] {
        const siblings = [];
        let tmp = target.node.nextSibling;
        while (tmp) {
            if (tmp.nodeType == 1) siblings.push({
                node: tmp as HTMLElement,
                baseTransform: this.getTransform(tmp as HTMLElement),
            });
            tmp = tmp.nextSibling;
        }
        return siblings;
    }

    updateScrolling() {
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
    }

    animateSwipe(callback: (target: ITarget) => void): void | boolean {
        const target: ITarget = this.target;
        const siblings = this.getSiblings(target);
        const emptySpaceTransformStyle = 'translate(0,' + this.target.height + 'px) ' + this.hwLayerMagicStyle + ' ';

        // FIXME: animate with real velocity
        target.node.style[this.transitionJSPropertyName as any] = 'all 0.1s linear';
        target.node.style[this.transformJSPropertyName as any] = ' translate(' + (this.getTotalMovement().x > 0 ? '' : '-') + '100%,0) ' + this.hwLayerMagicStyle + target.baseTransform.value;

        setTimeout(() => {
                if (callback.call(this, target)) {
                    siblings.forEach((o: ISibling) => {
                        o.node.style[this.transitionJSPropertyName as any] = '';
                        o.node.style[this.transformJSPropertyName as any] = emptySpaceTransformStyle + o.baseTransform.value;
                    });
                    setTimeout(() => {
                        siblings.forEach((o: ISibling) => {
                            o.node.style[this.transitionJSPropertyName as any] = this.transformCSSPropertyName + ' 0.1s ease-in-out';
                            o.node.style[this.transformJSPropertyName as any] = 'translate(0,0) ' + this.hwLayerMagicStyle + o.baseTransform.value;
                        });
                        setTimeout(() => {
                            siblings.forEach((o: ISibling) => {
                                o.node.style[this.transitionJSPropertyName as any] = '';
                                o.node.style[this.transformJSPropertyName as any] = o.baseTransform.original;
                            });
                        }, 101);
                    }, 1);
                }
            }, 101
        );
    }

    private _states(): IStates {
        let outer = this;

        return class {
            /*
            init() {
                switch (this.state) {
                    case 'idle':
                        this.idle();
                        outer.usingTouch = false;

                        return {
                            allowTextSelection: true,
                        };
                }
            }*/

            static idle() {
                outer.removeMouseHandlers();
                if (outer.target) {
                    outer.target.node.style.willChange = '';
                    delete outer.target;
                }
            }

            static undecided(): IStateImplement {
                outer.target.height = outer.target.node.offsetHeight;
                outer.target.node.style.willChange = outer.transformCSSPropertyName;
                outer.target.node.style[outer.transitionJSPropertyName as any] = '';

                let holdTimer = 0;

                if (!outer.dispatch(outer.target.originalTarget, 'beforewait')) {
                    if (outer.dispatch(outer.target.originalTarget, 'beforereorder')) {
                        outer.setState(outer.states.reorder);
                    }

                } else {
                    holdTimer = setTimeout(() => {
                        const move: Required<IMove> = outer.getAbsoluteMovement() as any;
                        if (outer.canPreventScrolling && move.x < 15 && move.y < 25) {
                            if (outer.dispatch(outer.target.originalTarget, 'beforereorder')) {
                                outer.setState(outer.states.reorder);
                            }
                        }
                    }, 300);
                }

                return {
                    leaveState: () => clearTimeout(holdTimer),
                    onMove: () => {
                        const move = outer.getAbsoluteMovement();

                        if (move.x > 20 && move.y < Math.max(100, outer.target.height || 0)) {
                            if (outer.dispatch(outer.target.originalTarget, 'beforeswipe', {
                                directionX: move.directionX,
                                directionY: move.directionY
                            })) {
                                outer.setState(outer.states.swipe);
                                return false;
                            } else {
                                outer.setState(outer.states.idle);
                            }
                        }
                        if (move.y > 20) {
                            outer.setState(outer.states.idle);
                        }

                        // Chrome likes sideways scrolling :(
                        if (move.x > move.y * 1.2) return false;
                    },

                    onLeave: () => outer.setState(outer.states.idle),
                    onEnd: () => {
                        const allowDefault = outer.dispatch(outer.target.originalTarget, 'tap');
                        outer.setState(outer.states.idle);
                        return allowDefault;
                    },
                };
            }

            static swipe(): IStateImplement {
                let swipeSuccess = false;
                const container = outer.container;

                const originalIndex = outer.findIndex(outer.target, outer.container.childNodes);

                container.classList.add('slip-swiping-container');

                const removeClass = () => container.classList.remove('slip-swiping-container');

                outer.target.height = outer.target.node.offsetHeight;

                return {
                    leaveState: () => {
                        if (swipeSuccess) {
                            outer.animateSwipe(target => {
                                target.node.style[outer.transformJSPropertyName as any] = target.baseTransform.original;
                                target.node.style[outer.transitionJSPropertyName as any] = '';
                                if (outer.dispatch(target.node, 'afterswipe')) {
                                    removeClass();
                                    return true;
                                } else {
                                    outer.animateToZero(undefined, target);
                                }
                            });
                        } else {
                            outer.animateToZero(removeClass);
                        }
                    },

                    onMove: () => {
                        const move = outer.getTotalMovement();

                        if (outer.target.height && Math.abs(move.y) < outer.target.height + 20) {
                            if (outer.dispatch(outer.target.node, 'animateswipe', {
                                x: move.x,
                                originalIndex: originalIndex
                            })) {
                                outer.target.node.style[outer.transformJSPropertyName as any] = 'translate(' + move.x + 'px,0) ' + outer.hwLayerMagicStyle + outer.target.baseTransform.value;
                            }
                            return false;
                        } else {
                            outer.dispatch(outer.target.node, 'cancelswipe');
                            outer.setState(outer.states.idle);
                        }
                    },

                    onLeave: this.swipe().onEnd,

                    onEnd: () => {
                        const move = outer.getAbsoluteMovement();
                        const velocity = move.x / move.time;

                        // How far out has the item been swiped?
                        const swipedPercent = Math.abs((outer.startPosition.x - outer.previousPosition.x) / outer.container.clientWidth) * 100;

                        const swiped = (velocity > outer.options.minimumSwipeVelocity && move.time > outer.options.minimumSwipeTime) || (outer.options.keepSwipingPercent && swipedPercent > outer.options.keepSwipingPercent);

                        if (swiped) {
                            if (outer.dispatch(outer.target.node, 'swipe', {
                                direction: move.directionX,
                                originalIndex: originalIndex
                            })) {
                                swipeSuccess = true; // can't animate here, leaveState overrides anim
                            }
                        } else {
                            outer.dispatch(outer.target.node, 'cancelswipe');
                        }
                        outer.setState(outer.states.idle);
                        return !swiped;
                    },
                };
            }

            static reorder(): IStateImplement {
                if (outer.target.node.focus && outer.accessibility.items.focus) {
                    outer.target.node.focus();
                }

                outer.target.height = outer.target.node.offsetHeight;

                let nodes: NodeListOf<Node & ChildNode>;
                if (outer.options.ignoredElements.length) {
                    const container = outer.container;
                    let query = container.tagName.toLowerCase();
                    if (container.getAttribute('id')) {
                        query = '#' + container.getAttribute('id');
                    } else if (container.classList.length) {
                        query += '.' + (container.getAttribute('class') as string)
                            .replace(' ', '.');
                    }
                    query += ' > ';
                    outer.options.ignoredElements.forEach((selector) => {
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
                    nodes = outer.container.childNodes as NodeListOf<Node & ChildNode>;
                }
                const originalIndex = outer.findIndex(outer.target, nodes);
                let mouseOutsideTimer: number | null;
                const zero = outer.target.node.offsetTop + outer.target.height / 2;
                const otherNodes: {node: Node & ChildNode, baseTransform: ITransform, pos: number}[] = [];
                for (let i = 0; i < nodes.length; i++) {
                    if (nodes[i].nodeType != 1 || nodes[i] === outer.target.node) continue;
                    const t = (nodes[i] as HTMLElement).offsetTop;
                    (nodes[i] as HTMLElement).style[outer.transitionJSPropertyName as any] = outer.transformCSSPropertyName + ' 0.2s ease-in-out';
                    otherNodes.push({
                        node: nodes[i],
                        baseTransform: outer.getTransform(nodes[i] as HTMLElement),
                        pos: t + (t < zero ? (nodes[i] as HTMLElement).offsetHeight : 0) - zero,
                    });
                }

                outer.target.node.classList.add('slip-reordering');
                outer.target.node.style.zIndex = '99999';
                outer.target.node.style[outer.userSelectJSPropertyName as any] = 'none';
                if (outer.compositorDoesNotOrderLayers) {
                    // Chrome's compositor doesn't sort 2D layers
                    outer.container.style.webkitTransformStyle = 'preserve-3d';
                }

                const onMove = () => {
                    /*jshint validthis:true */

                    outer.updateScrolling();

                    if (mouseOutsideTimer) {
                        // don't care where the mouse is as long as it moves
                        clearTimeout(mouseOutsideTimer);
                        mouseOutsideTimer = null;
                    }

                    const move = outer.getTotalMovement();
                    outer.target.node.style[outer.transformJSPropertyName as any] = 'translate(0,' + move.y + 'px) ' + outer.hwTopLayerMagicStyle + outer.target.baseTransform.value;

                    const height = outer.target.height || 0;
                    otherNodes.forEach(function(o) {
                        let off = 0;
                        if (o.pos < 0 && move.y < 0 && o.pos > move.y) {
                            off = height;
                        }
                        else if (o.pos > 0 && move.y > 0 && o.pos < move.y) {
                            off = -height;
                        }
                        // FIXME: should change accelerated/non-accelerated state lazily
                        (o.node as HTMLElement).style[outer.transformJSPropertyName as any] = off ? 'translate(0,' + off + 'px) ' + outer.hwLayerMagicStyle + o.baseTransform.value : o.baseTransform.original;
                    });
                    return false;
                };

                onMove();

                return {
                    leaveState: () => {
                        if (mouseOutsideTimer) clearTimeout(mouseOutsideTimer);

                        if (outer.compositorDoesNotOrderLayers) {
                            outer.container.style.webkitTransformStyle = '';
                        }

                        if (outer.container.focus && outer.accessibility.container.focus) {
                            outer.container.focus();
                        }

                        outer.target.node.classList.remove('slip-reordering');
                        outer.target.node.style[outer.userSelectJSPropertyName as any] = '';

                        outer.animateToZero((target: ITarget) => target.node.style.zIndex = '');
                        otherNodes.forEach(o => {
                            (o.node as HTMLElement).style[outer.transformJSPropertyName as any] = o.baseTransform.original;
                            (o.node as HTMLElement).style[outer.transitionJSPropertyName as any] = ''; // FIXME: animate to new position
                        });
                    },

                    onMove: onMove,

                    onLeave: () => {
                        // don't let element get stuck if mouse left the window
                        // but don't cancel immediately as it'd be annoying near window edges
                        if (mouseOutsideTimer) clearTimeout(mouseOutsideTimer);
                        mouseOutsideTimer = setTimeout(() => {
                                mouseOutsideTimer = null;
                                outer.cancel();
                            }, 700
                        )
                        ;
                    },

                    onEnd: () => {
                        const move = outer.getTotalMovement();
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

                        outer.dispatch(outer.target.node, 'reorder', {
                            spliceIndex: spliceIndex,
                            originalIndex: originalIndex,
                            insertBefore: otherNodes[spliceIndex] ? (otherNodes[spliceIndex] as any).node : undefined,
                        });

                        outer.setState(outer.states.idle);
                        return false;
                    },
                };
            }
        }
    }

    private getTransform(node: HTMLElement): ITransform {
        const transform = node.style[this.transformJSPropertyName as any];
        if (transform) {
            return {
                value: transform,
                original: transform,
            };
        }

        if (window.getComputedStyle) {
            const style = window.getComputedStyle(node).getPropertyValue(this.transformCSSPropertyName);
            if (style && style !== 'none') return { value: style, original: '' };
        }
        return { value: '', original: '' };
    }

    /// states

    private findIndex(target: {node: HTMLElement}, nodes: NodeListOf<Node & ChildNode>): number {
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
    }
}

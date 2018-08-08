export interface ISlip extends IState, IDispatch, IMovement {
    (container: HTMLElement | null, options: IOptions): ISlip;

    options: IOptions;
    states: IStates;
    _states: () => IStates;
    attach: (container: HTMLElement) => void;
    container: HTMLElement;
    latestPosition?: IPosition;
    startPosition?: IPosition;
    previousPosition?: IPosition;
    animateSwipe: (callback: (target: ITarget) => void) => void | boolean;
    animateToZero: (callback?: (target: ITarget) => void, target?: ITarget) => void | boolean;
    getTotalMovement: () => IPosition;
    updateScrolling: () => void;
    target?: ITarget;
    state?: IState;
    detach: () => void;
    setChildNodesAriaRoles: () => void;
    unSetChildNodesAriaRoles: () => void;
    otherNodes: {node: Node & ChildNode, baseTransform: ITransform, pos: | EventTarget}[];
    findTargetNode: (targetNode: Node | null) => Node | null;
    mouseHandlersAttached: boolean;
    usingTouch: boolean;
    addMouseHandlers: () => void;
    canPreventScrolling: boolean;
    startAtPosition: (position: IPosition) => void;
    setTarget: (e: MouseEvent & MSGesture) => boolean;
    getSiblings: (target: ITarget) => ISibling[];
    updatePosition: (e: MouseEvent | TouchEvent, position: IPosition) => void;
    cancel: () => void;
}

interface IDispatch {
    dispatch: (targetNode: EventTarget, eventName: TEvent,
               move?: IMove) => void;
}

interface IMovement {
    getAbsoluteMovement: () => IMove;
}

export interface IOptions {
    keepSwipingPercent: number;
    minimumSwipeVelocity: number;
    minimumSwipeTime: number;
    ignoredElements: HTMLElement[];
    attach: ISlip['attach'];
}

export interface IPosition {
    x: number;
    y: number;
    time: number;
}

export interface IState extends IStateImplement {
    cancel: () => void;
    onTouchStart: (e: TouchEvent) => void;
    onTouchMove: (e: TouchEvent) => void;
    onTouchEnd: (e: TouchEvent) => void;
    onMouseDown: (e: MouseEvent & MSGesture) => void;
    onMouseMove: (e: MouseEvent) => void;
    onMouseUp: (e: MouseEvent) => void;
    onMouseLeave: (e: MouseEvent) => void;
    onSelection: (e: Event & Node) => void;
    onContainerFocus: (e: TouchEvent) => void;

    setState: (state: ISlip['states']['idle']) => void;
    ctor: () => void;

    allowTextSelection: boolean;
}

interface IStateSelected extends IMovement {
    removeMouseHandlers: () => void;
    usingTouch: boolean;
    target: ITarget | null;
    setState: (state: IStateSelected['states']['reorder']) => void;
    states: ISlip['states'];
    canPreventScrolling: boolean;
    container: HTMLElement;
}

export interface IStateIdle extends IStateSelected {

}

export interface IStateUndecided extends IStateSelected, IDispatch {
    target: ITarget;
}

export interface IStateReorder extends IStateUndecided, ISlip {

}

export interface ITarget {
    node: HTMLElement & {style: {willChange?: string;}};
    height?: number;
    originalTarget: EventTarget;
    baseTransform: ITransform;
    scrollContainer: HTMLElement;
    origScrollTop: number;
    origScrollHeight: number;
}

export interface ISibling {
    node: HTMLElement;
    baseTransform: ITransform;
}

export interface ITransform {
    value: string;
    original: string;
}

export interface IMove {
    directionX?: string;
    directionY?: string;
    x?: number;
    y?: number;
    originalIndex?: number;
    direction?: string;
    time?: number;
    spliceIndex?: number;
    insertBefore?: {node: Node & ChildNode, baseTransform: ITransform, pos: number};
}

export interface IStates {
    idle: () => void;
    undecided: () => void;
    swipe: () => void;
    reorder: () => void;
}

export interface IStateImplement {
    leaveState: () => void;
    onLeave: () => void;
    onEnd: () => void;
    onMove: () => void;
}

type TEvent = 'beforewait' | 'beforereorder' | 'beforeswipe' | 'tap' | 'afterswipe'
    | 'animateswipe' | 'cancelswipe' | 'swipe' | 'reorder'
    | 'mouseleave' | 'mousemove' | 'mouseup' | 'blur';

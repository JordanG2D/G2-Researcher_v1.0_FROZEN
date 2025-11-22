import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

interface StreamingMarkdownProps {
    content: string;
    /**
     * A key that identifies a logical block of streaming content.
     * When this changes (e.g. new thought / new cell), we restart the animation.
     */
    animateKey?: string | number;
    /**
     * Tailwind / CSS classes applied to the markdown body wrapper.
     */
    markdownClassName?: string;
    /**
     * Optional classes for the outer container (animation wrapper).
     */
    wrapperClassName?: string;
}

/**
 * StreamingMarkdown
 *
 * Renders markdown that is being updated incrementally (streamed tokens).
 * Every time the content changes, we softly re-trigger a fade-in animation
 * on the entire block using the global `.stream-fade` styles.
 *
 * This keeps the effect subtle but ensures *all* new streamed chunks
 * participate in the animation, not just the initial thought.
 */
export function StreamingMarkdown({
    content,
    animateKey,
    markdownClassName,
    wrapperClassName,
}: StreamingMarkdownProps) {
    const [isAnimating, setIsAnimating] = useState(false);

    useEffect(() => {
        if (typeof window === "undefined") return;

        let timeoutId: number | null = null;
        const rafId = window.requestAnimationFrame(() => {
            setIsAnimating(true);
            timeoutId = window.setTimeout(() => setIsAnimating(false), 420); // match CSS duration
        });

        return () => {
            window.cancelAnimationFrame(rafId);
            if (timeoutId !== null) window.clearTimeout(timeoutId);
        };
    }, [content, animateKey]);

    return (
        <div
            className={cn(
                "stream-fade",
                isAnimating && "stream-fade--active",
                wrapperClassName
            )}
        >
            <div className={markdownClassName}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {content}
                </ReactMarkdown>
            </div>
        </div>
    );
}

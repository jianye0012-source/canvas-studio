import { useState } from "react";

export function useFirstSuccessPrompt() {
	const [firstSuccessGuideOpen, setFirstSuccessGuideOpen] = useState(false);
	const [useCaseAskOpen, setUseCaseAskOpen] = useState(false);
	return { firstSuccessGuideOpen, setFirstSuccessGuideOpen, useCaseAskOpen, setUseCaseAskOpen };
}

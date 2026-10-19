  

  ![[History Find.png]]
코멘트는 좀 구글 독스처럼 자연스럽게 원본 문서 옆에 코멘트 블록으로 뜨게 하자, 이렇게. 코멘트 열었다 닫았다 하는 UX는 좋지 않다

  

코멘트를 가리게 하는 건 되는데 기본을 그냥.녹스처럼 그냥 구독자 똑같이 거의 똑같이 그냥 오른쪽에 나오게 하면 훨씬 더 시각적으로 자연스러운 형태가 되는 거지. 이러면 이제 코멘트 바랑 원문이랑 약간 분리가 된 느낌이지. Whereas 구글 독스처럼 그 하이라이트한, 코멘트 하이라이트한 부분 바로 옆에 코멘트 블락이 오른쪽 사이드에 붙고 그런 식으로.

  

  ![[Check the Norean sample is now the soth Unticked task in the Neat steps ast or Ps sttito note. ladsed.png]]

더할것: inline 하이퍼링킹. Agent can already open the document for human, but instead we can also let agent just Hyperlinked artifact which opens on the sidebar when human clicks. 
(and this adds to SessionStartHook for MAWS as instruction to hyperlink artifact or whatever so that human can open on sidebar with click)

  

So that the human doesn't have to ask again, can you open it for me? Where can I open it? And so on and so on. Just inline message hyperlinking opens the file within MAWS.

  

(Like output style rendering with markdown backlink reference opens that file on cmd+click, some sort of reference linking in-line message should let user open that artifact/file by click)

  

  

  ![[P3 Sitting note.png]]

—> Three dot is not needed, Just make it like a regular web browser. Right click replace three dot, and ‘x’ is embedded in block so that closing artifact tab is easy


![[Pasted image 20261019045623.png]]

--> deck 편집중: docs처럼 사이드바를 특정 수준 이상 확장했을때 채팅이 오른쪽 아래 floating widget으로 축소되는게 없다. 이것도 필요


![[Pasted image 20261019045752.png]]
--> 슬라이드 편집이 상당히 스무스하지 않다. 캔바나 구글 슬라이드처럼 컴포넌트를 눌렀을 때 바로 편집 가능한 게 아니라 두 번, 세 번, 더블 클릭, 트리플 클릭해야지 텍스트를 수정할 수 있는 상태가 나온다. 이 부분에 대해서도 생각해봐야지 않을까.

Design도 마찬가지. 접근성 트리? DOM? 이 너무 구리다. 구글 슬라이드/캔바의 검증된 메커니즘을 그대로 Adopt하기. 

추가질문: Artifact Search 툴 있나? slide, docs, design, dashboard 등등을 그때그때 검색으로 로딩하게 해주는 툴 같은것? 그게 없다면은 모델은 어디에서 아티팩트의 맥락을 가져오는 건지, 세션에 로드된 아티팩트만을 기준으로 하는 건지?


![[Pasted image 20261019051623.png]]

오른쪽의 sitting note또한 artifact인데 오른쪽의 사이드바 탭을 join할 . 수없는 모습이다. 탭에 대한 drag to move가 막힘.
![[Pasted image 20261019051949.png]]
--> 그래서 이렇게 중복으로 열린 모습


![[Pasted image 20261019054856.png]]
MInor UX:

맨 오른쪽의 'p3-sitting-project' (프로젝트 이름 표시 탭) --> 이건 탭 자리 말고 탭 위의 공간 (opennotion route check 글씨가 있는 바 공간) 에 들어가야한다. 탭은 안그래도 crowded하고 공간이 부족한데 별거 안하는 프로젝트 표시탭을 저기다 두면 안된다.
프로젝트 표시 아이콘/탭을 탭바 위 공간의 바로 올리고, 클릭 할시에는 해당 프로젝트의 새 탭 공간을 열게 하자 
(왼쪽 사이드바에서 프로젝트 옆 '+'누르는것과 같은 효과)


![[Pasted image 20261019063251.png]]

I don't know whose bug this is, but there are alphabets just floating there.
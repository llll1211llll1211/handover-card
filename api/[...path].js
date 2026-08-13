/*
 * 배포 환경에서 /api/* 요청을 백엔드로 넘기는 프록시.
 *
 * 원래는 vercel.json 의 rewrite 하나로 넘겼는데, 그 방식은 브라우저가 보낸
 * Origin 헤더를 그대로 백엔드에 전달한다. 백엔드는 허용 목록에 없는 Origin 을
 * 보면 엔드포인트에 닿기도 전에 "Invalid CORS request" 로 막는다.
 *
 * 브라우저는 같은 도메인이라도 POST·PUT·DELETE 에는 Origin 을 붙이고 GET 에는
 * 붙이지 않는다. 그래서 화면은 뜨는데 로그인·회원가입·카드 생성만 죽었다.
 *
 * 여기서 Origin 을 떼고 보낸다. 서버에서 서버로 가는 요청이라 CORS 는 애초에
 * 성립하지 않는 맥락이고, 브라우저 보호와도 무관하다.
 *
 * 백엔드가 배포 도메인을 CORS 허용 목록에 넣어 주면 이 파일 없이도 동작한다.
 * 그때 되돌리려면 이 파일을 지우고 vercel.json 에 아래 rewrite 를 되살리면 된다.
 *   { "source": "/api/:path*", "destination": "https://api.handover-card.o-r.kr/api/:path*" }
 */

export const config = { runtime: 'edge' }

const BACKEND = 'https://api.handover-card.o-r.kr'

export default async function handler(request) {
  const url = new URL(request.url)

  // 들어온 경로가 이미 /api/... 이고 백엔드도 같은 경로를 쓰므로 그대로 붙인다
  const target = BACKEND + url.pathname + url.search

  const headers = new Headers(request.headers)
  // 백엔드의 CORS 필터가 보고 막는 헤더들. 서버끼리의 요청이므로 뗀다.
  headers.delete('origin')
  headers.delete('referer')
  // 아래는 프록시 자신의 주소라 백엔드에 넘기면 안 된다
  headers.delete('host')
  headers.delete('x-forwarded-host')

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'

  let upstream
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      // 녹음 파일 업로드를 메모리에 다 올리지 않도록 스트림 그대로 넘긴다.
      // 스트림을 본문으로 쓸 때는 duplex 를 명시해야 한다.
      body: hasBody ? request.body : undefined,
      duplex: 'half',
      redirect: 'manual',
    })
  } catch (err) {
    // 백엔드가 죽었을 때 프록시가 500 을 내면 원인이 프론트처럼 보인다.
    // client.ts 가 message 키를 먼저 읽으므로 그 형식으로 준다.
    return new Response(JSON.stringify({ message: '서버에 연결할 수 없습니다. (' + err.message + ')' }), {
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
  }

  const resHeaders = new Headers(upstream.headers)
  // fetch 가 압축을 이미 풀어 준 본문이라, 원본 헤더를 그대로 두면 길이가 어긋난다
  resHeaders.delete('content-encoding')
  resHeaders.delete('content-length')
  resHeaders.delete('transfer-encoding')

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: resHeaders,
  })
}
